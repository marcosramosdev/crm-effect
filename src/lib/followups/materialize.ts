// ============================================================
// Follow-up preparation — design.md D2.
//
// Two passes, and NOTHING else: materialise the pending rows that
// are now due, and expire the pending/approved rows whose appointment
// has passed. Deliberately does not import anything from
// `src/lib/whatsapp/` (enforced by materialize.test.ts) — that import
// boundary is the mechanical statement of "the cron cannot send".
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { renderFollowupBody } from "./render";

interface DealForMaterialize {
  id: string;
  conversation_id: string | null;
  scheduled_at: string | null;
  archived_at: string | null;
  status: string | null;
  contact: { name: string | null } | { name: string | null }[] | null;
  custom_values:
    | { value: string | null; field: { field_name: string } | { field_name: string }[] | null }[]
    | null;
}

interface AccountForMaterialize {
  id: string;
  followup_offsets: number[] | null;
  followup_reminder_template: string | null;
  timezone: string | null;
}

/**
 * Whether a follow-up for `offsetMinutes` is due right now: the
 * deal has a future appointment, isn't archived, isn't lost, and the
 * offset's lead time has been reached (specs/followups/spec.md, "A
 * booked lead produces one pending follow-up per configured offset").
 * Pure — no I/O — so every filtering scenario is testable with no DB.
 */
export function isFollowupDue(
  deal: { scheduled_at: string | null; archived_at: string | null; status: string | null },
  offsetMinutes: number,
  now: Date,
): boolean {
  if (!deal.scheduled_at) return false;
  if (deal.archived_at) return false;
  if (deal.status === "lost") return false;
  const scheduledMs = new Date(deal.scheduled_at).getTime();
  const dueAtMs = scheduledMs - offsetMinutes * 60_000;
  const nowMs = now.getTime();
  return dueAtMs <= nowMs && nowMs < scheduledMs;
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function resolveMedico(deal: DealForMaterialize): string | null {
  for (const cv of deal.custom_values ?? []) {
    const field = firstOf(cv.field);
    if (field?.field_name?.trim().toLowerCase() === "medico") {
      return cv.value ?? null;
    }
  }
  return null;
}

const DEAL_SELECT =
  "id, conversation_id, scheduled_at, archived_at, status, " +
  "contact:contacts(name), " +
  "custom_values:deal_custom_values(value, field:deal_custom_fields(field_name))";

/**
 * Materialise: insert a `pending` row for every (deal, offset) pair
 * that is due and doesn't have one yet. `ON CONFLICT (deal_id,
 * offset_minutes) DO NOTHING` is the DB-level dedupe (migration 047);
 * `.select()` after an ignore-duplicates upsert returns only the rows
 * actually inserted, so the count is exact.
 */
export async function materializeFollowups(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<{ created: number }> {
  const { data: accounts, error: acctErr } = await db
    .from("accounts")
    .select("id, followup_offsets, followup_reminder_template, timezone");
  if (acctErr) throw acctErr;

  let created = 0;
  for (const account of (accounts ?? []) as AccountForMaterialize[]) {
    const offsets = account.followup_offsets ?? [];
    if (offsets.length === 0) continue;

    const { data: deals, error: dealsErr } = await db
      .from("deals")
      .select(DEAL_SELECT)
      .eq("account_id", account.id)
      .not("scheduled_at", "is", null)
      .is("archived_at", null)
      .neq("status", "lost");
    if (dealsErr) throw dealsErr;

    const rows: Record<string, unknown>[] = [];
    for (const deal of (deals ?? []) as unknown as DealForMaterialize[]) {
      const dueOffsets = offsets.filter((o) => isFollowupDue(deal, o, now));
      if (dueOffsets.length === 0) continue;

      const contact = firstOf(deal.contact);
      const body = renderFollowupBody(
        account.followup_reminder_template ?? "",
        {
          contactName: contact?.name ?? null,
          scheduledAt: deal.scheduled_at!,
          customFieldsByName: { medico: resolveMedico(deal) },
        },
        account.timezone ?? "America/Sao_Paulo",
      );

      for (const offsetMinutes of dueOffsets) {
        rows.push({
          account_id: account.id,
          deal_id: deal.id,
          conversation_id: deal.conversation_id,
          offset_minutes: offsetMinutes,
          body,
          status: "pending",
        });
      }
    }

    if (rows.length === 0) continue;
    const { data: inserted, error: upsertErr } = await db
      .from("followup_messages")
      .upsert(rows, { onConflict: "deal_id,offset_minutes", ignoreDuplicates: true })
      .select("id");
    if (upsertErr) throw upsertErr;
    created += inserted?.length ?? 0;
  }

  return { created };
}

/**
 * Expire: move every `pending`/`approved` row whose deal's
 * appointment has passed to `expired` (design.md D2 pass 2 — `sent`
 * is left alone, `approved` is included so a permanently failing
 * send doesn't sit in the queue forever).
 *
 * Scoped to `pending`/`approved` rows rather than "every deal whose
 * scheduled_at is in the past" — that set is bounded by how much
 * *outstanding* work exists (a clinic's few tens of open follow-ups),
 * not by the account's entire appointment history.
 */
export async function expireFollowups(
  db: SupabaseClient,
  now: Date = new Date(),
): Promise<{ expired: number }> {
  const { data: rows, error: selectErr } = await db
    .from("followup_messages")
    .select("id, deal:deals(scheduled_at)")
    .in("status", ["pending", "approved"]);
  if (selectErr) throw selectErr;

  const nowMs = now.getTime();
  const idsToExpire = ((rows ?? []) as { id: string; deal: { scheduled_at: string | null } | { scheduled_at: string | null }[] | null }[])
    .filter((row) => {
      const deal = firstOf(row.deal);
      return !!deal?.scheduled_at && new Date(deal.scheduled_at).getTime() <= nowMs;
    })
    .map((row) => row.id);

  if (idsToExpire.length === 0) return { expired: 0 };

  const { data: updated, error: updateErr } = await db
    .from("followup_messages")
    .update({ status: "expired" })
    .in("id", idsToExpire)
    .select("id");
  if (updateErr) throw updateErr;

  return { expired: updated?.length ?? 0 };
}
