// ============================================================
// Public-API broadcast core.
//
// Splits a broadcast into two phases so the HTTP route can persist +
// acknowledge fast and fan out afterwards (in `after()`):
//
//   createBroadcast()  — validate, resolve contacts + {{field}}
//                        variables per recipient, insert the
//                        `broadcasts` row + `broadcast_recipients`
//                        rows (status 'pending', or 'failed' up front
//                        for an unresolved variable), return a plan.
//   deliverBroadcast() — send each recipient's free-form text/media
//                        through UAZAPI (phone-variant retry +
//                        rate-limit back-off), stamp each recipient
//                        row + the aggregate counts, finalize status.
//
// Recipient rows carry `whatsapp_message_id`, so the inbound webhook's
// status handler (which matches on that column) updates delivered/read
// for API broadcasts exactly as it does for dashboard ones.
//
// Replaces the Meta-template version of this module — see
// openspec/changes/replace-meta-with-uazapi/design.md D1, D5.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendTextMessage,
  sendMediaMessage,
  fetchMediaAsBase64,
  type MediaKind,
} from "@/lib/whatsapp/uazapi";
import { UazapiError } from "@/lib/whatsapp/uazapi-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";
import {
  extractVariableNames,
  resolveVariableValues,
  substituteVariables,
} from "@/lib/whatsapp/broadcast-variables";
import type { BroadcastMediaKind } from "@/types";
import { findOrCreateContact } from "@/lib/api/v1/contacts";

/** Thrown by createBroadcast on a caller-visible failure; route maps it. */
export class BroadcastError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "BroadcastError";
    this.code = code;
    this.status = status;
  }
}

export interface BroadcastRecipientInput {
  /** E.164 phone. */
  to: string;
}

export interface CreateBroadcastParams {
  name?: string | null;
  /** Free-form body, optionally with `{{field}}` placeholders. */
  messageBody: string;
  mediaUrl?: string | null;
  mediaKind?: BroadcastMediaKind | null;
  mediaFilename?: string | null;
  /** Per-variable fallback used when a recipient has no value for it. */
  variableDefaults?: Record<string, string> | null;
  recipients: BroadcastRecipientInput[];
}

interface PlannedRecipient {
  recipientRowId: string;
  phone: string;
  /** Frozen `{{field}}` → value map — see broadcast-variables.ts. */
  values: Record<string, string>;
}

export interface BroadcastPlan {
  broadcastId: string;
  accountId: string;
  messageBody: string;
  mediaUrl: string | null;
  mediaKind: BroadcastMediaKind | null;
  mediaFilename: string | null;
  instanceToken: string;
  planned: PlannedRecipient[];
  /** Phones rejected up front (invalid E.164) — counted as failed. */
  rejected: number;
}

const MAX_RECIPIENTS = 1000;
/** Fetch contact/custom-field rows in pages to stay under PostgREST's IN-clause cap. */
const LOOKUP_PAGE_SIZE = 500;

const BUILTIN_CONTACT_FIELDS = new Set(["name", "phone", "email", "company"]);

async function fetchInPages<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += LOOKUP_PAGE_SIZE) {
    const slice = ids.slice(i, i + LOOKUP_PAGE_SIZE);
    const { data } = await db.from(table).select(columns).in(column, slice);
    rows.push(...((data ?? []) as T[]));
  }
  return rows;
}

/**
 * Validate + persist a broadcast, resolving each recipient to a
 * contact and resolving every `{{field}}` placeholder against that
 * contact's fields / custom fields. Returns a plan for
 * {@link deliverBroadcast}. Throws {@link BroadcastError} on bad input
 * / missing config / a DB failure — nothing is sent in this phase.
 */
export async function createBroadcast(
  db: SupabaseClient,
  accountId: string,
  auditUserId: string,
  params: CreateBroadcastParams,
): Promise<BroadcastPlan> {
  const {
    name,
    messageBody,
    mediaUrl,
    mediaKind,
    mediaFilename,
    variableDefaults,
    recipients,
  } = params;

  // Broadcasts spec, "Empty body is rejected" — a body-less broadcast
  // is fine ONLY when there's an attachment to carry it (the body then
  // doubles as an optional caption).
  if (!(messageBody && messageBody.trim()) && !mediaUrl) {
    throw new BroadcastError(
      "bad_request",
      "'message_body' is required unless a media attachment is provided",
      400,
    );
  }
  if (mediaUrl && !mediaKind) {
    throw new BroadcastError(
      "bad_request",
      "'media_kind' is required when 'media_url' is provided",
      400,
    );
  }
  if (!Array.isArray(recipients) || recipients.length === 0) {
    throw new BroadcastError(
      "bad_request",
      "'recipients' must be a non-empty array of { to }",
      400,
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    throw new BroadcastError(
      "bad_request",
      `A broadcast is capped at ${MAX_RECIPIENTS} recipients per request; split larger sends`,
      400,
    );
  }

  // Config (fail fast + provides the audit trail owner already resolved
  // by the caller). Only a provisioned instance is required here — a
  // transient disconnect is checked again at dispatch time
  // (deliverBroadcast), where it leaves recipients resumable instead of
  // blocking the whole campaign from being created.
  const { data: config, error: configError } = await db
    .from("whatsapp_config")
    .select("instance_token")
    .eq("account_id", accountId)
    .single();
  if (configError || !config || !config.instance_token) {
    throw new BroadcastError(
      "whatsapp_not_configured",
      "WhatsApp not configured. Please set up your WhatsApp integration first.",
      400,
    );
  }
  const instanceToken = decrypt(config.instance_token);

  // Resolve each recipient to a contact. Invalid phones are dropped
  // (counted as rejected) rather than aborting the whole broadcast.
  const resolved: { contactId: string; phone: string }[] = [];
  let rejected = 0;
  for (const r of recipients) {
    const sanitized = sanitizePhoneForMeta(
      typeof r.to === "string" ? r.to : "",
    );
    if (!isValidE164(sanitized)) {
      rejected++;
      continue;
    }
    const { id } = await findOrCreateContact(db, accountId, auditUserId, {
      phone: sanitized,
    });
    resolved.push({ contactId: id, phone: sanitized });
  }

  // Collapse recipients that resolved to the SAME contact (the caller
  // listed a phone twice, or two numbers fuzzy-matched to one contact).
  // Keep the first occurrence so the contact is messaged once.
  const seenContact = new Set<string>();
  const deduped = resolved.filter((r) => {
    if (seenContact.has(r.contactId)) return false;
    seenContact.add(r.contactId);
    return true;
  });

  if (deduped.length === 0) {
    throw new BroadcastError(
      "bad_request",
      "No recipients had a valid E.164 phone number",
      400,
    );
  }

  // Resolve {{field}} placeholders per recipient — broadcasts spec,
  // "Per-recipient variable substitution". Skipped entirely (no extra
  // queries) when the body has no placeholders.
  const variableNames = extractVariableNames(messageBody ?? "");
  const contactIds = deduped.map((r) => r.contactId);

  let contactById = new Map<
    string,
    { name?: string; phone?: string; email?: string; company?: string }
  >();
  const customValuesByContact = new Map<string, Map<string, string>>();

  if (variableNames.length > 0) {
    const contactRows = await fetchInPages<{
      id: string;
      name?: string;
      phone?: string;
      email?: string;
      company?: string;
    }>(db, "contacts", "id, name, phone, email, company", "id", contactIds);
    contactById = new Map(contactRows.map((c) => [c.id, c]));

    const needsCustomFields = variableNames.some(
      (n) => !BUILTIN_CONTACT_FIELDS.has(n.toLowerCase()),
    );
    if (needsCustomFields) {
      const { data: fieldRows } = await db
        .from("custom_fields")
        .select("id, field_name")
        .eq("account_id", accountId);
      const fieldNameById = new Map(
        (fieldRows ?? []).map((f) => [
          f.id as string,
          (f.field_name as string).toLowerCase(),
        ]),
      );
      const valueRows = await fetchInPages<{
        contact_id: string;
        custom_field_id: string;
        value: string | null;
      }>(
        db,
        "contact_custom_values",
        "contact_id, custom_field_id, value",
        "contact_id",
        contactIds,
      );
      for (const row of valueRows) {
        const fieldName = fieldNameById.get(row.custom_field_id);
        if (!fieldName) continue;
        const bucket = customValuesByContact.get(row.contact_id) ?? new Map();
        bucket.set(fieldName, row.value ?? "");
        customValuesByContact.set(row.contact_id, bucket);
      }
    }
  }

  interface ResolvedRecipient {
    contactId: string;
    phone: string;
    values: Record<string, string>;
    unresolvedVariable?: string;
  }

  const finalRecipients: ResolvedRecipient[] = deduped.map((r) => {
    if (variableNames.length === 0) {
      return { contactId: r.contactId, phone: r.phone, values: {} };
    }
    const contact = contactById.get(r.contactId);
    const { values, unresolvedVariable } = resolveVariableValues(
      variableNames,
      {
        name: contact?.name,
        phone: contact?.phone,
        email: contact?.email,
        company: contact?.company,
        customValues: customValuesByContact.get(r.contactId),
      },
      variableDefaults,
    );
    return {
      contactId: r.contactId,
      phone: r.phone,
      values,
      unresolvedVariable,
    };
  });

  // Persist the broadcast + its recipients in ONE transaction (migration
  // 037/040's create_broadcast_with_recipients) — a recipient-insert
  // failure rolls the parent back rather than leaving an orphaned
  // campaign with no delivery plan (issue #370).
  const { data: createdRows, error: createErr } = await db.rpc(
    "create_broadcast_with_recipients",
    {
      p_account_id: accountId,
      p_user_id: auditUserId,
      p_name: name || `API broadcast (${new Date().toISOString()})`,
      p_message_body: messageBody ?? "",
      p_media_url: mediaUrl ?? null,
      p_media_kind: mediaKind ?? null,
      p_media_filename: mediaFilename ?? null,
      p_total_recipients: finalRecipients.length,
      p_contact_ids: finalRecipients.map((r) => r.contactId),
      p_variable_values: finalRecipients.map((r) => r.values),
    },
  );
  if (createErr || !createdRows || createdRows.length === 0) {
    console.error("[broadcast-core] create broadcast error:", createErr);
    throw new BroadcastError("internal", "Failed to create broadcast", 500);
  }

  const broadcastId = createdRows[0].broadcast_id as string;

  // Pair each inserted recipient row back to its phone/values by
  // contact_id — unambiguous now that duplicates are collapsed.
  const byContact = new Map(finalRecipients.map((r) => [r.contactId, r]));
  const planned: PlannedRecipient[] = [];
  const failNow = new Map<string, string[]>(); // error message -> recipient row ids

  for (const row of createdRows as {
    recipient_id: string;
    contact_id: string;
  }[]) {
    const r = byContact.get(row.contact_id)!;
    if (r.unresolvedVariable) {
      const message = `Missing value for "{{${r.unresolvedVariable}}}" — this contact has no value for it and no fallback was set.`;
      const ids = failNow.get(message) ?? [];
      ids.push(row.recipient_id);
      failNow.set(message, ids);
      continue;
    }
    planned.push({
      recipientRowId: row.recipient_id,
      phone: r.phone,
      values: r.values,
    });
  }

  // Flip unresolved-variable recipients from the RPC's default 'pending'
  // to 'failed' immediately — broadcasts spec, "Missing value with no
  // fallback": they count toward total_recipients (unlike a rejected
  // invalid phone) but never enter the send loop. Grouped by identical
  // message so this stays a handful of queries, not one per recipient.
  for (const [message, ids] of failNow) {
    await db
      .from("broadcast_recipients")
      .update({ status: "failed", error_message: message })
      .in("id", ids);
  }

  return {
    broadcastId,
    accountId,
    messageBody: messageBody ?? "",
    mediaUrl: mediaUrl ?? null,
    mediaKind: mediaKind ?? null,
    mediaFilename: mediaFilename ?? null,
    instanceToken,
    planned,
    rejected,
  };
}

// ============================================================
// Delivery — rate-limit back-off (design.md's "Loss of Meta delivery
// guarantees" risk; broadcasts spec, "Rate limit encountered mid-run")
// ============================================================

/** Attempts (including the first) before a persistent 429 gives up on this recipient. */
const RATE_LIMIT_BACKOFF_MS = [250, 750];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a single UAZAPI send with back-off on `rate_limited`. Any
 * other failure (including a rate limit that never clears) propagates
 * to the caller unchanged.
 */
async function sendWithRateLimitBackoff<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (
        !(err instanceof UazapiError) ||
        err.code !== "rate_limited" ||
        i >= RATE_LIMIT_BACKOFF_MS.length
      ) {
        throw err;
      }
      await sleep(RATE_LIMIT_BACKOFF_MS[i]);
    }
  }
}

/** True for a failure that means "the instance itself is in trouble right
 *  now" — a persistent rate limit or a stale/unauthenticated token —
 *  as opposed to a failure specific to one recipient. */
function isInstanceTrouble(err: unknown): boolean {
  return (
    err instanceof UazapiError &&
    (err.code === "rate_limited" || err.code === "unauthenticated")
  );
}

/**
 * Fan out a {@link BroadcastPlan}: send each recipient's free-form
 * text/media (phone-variant retry + rate-limit back-off) and stamp its
 * `broadcast_recipients` row. Best-effort per recipient — one failure
 * never aborts the rest, UNLESS the instance itself looks disconnected
 * or persistently rate-limited, in which case the pass stops and every
 * remaining recipient (this one included) is left 'pending' for a
 * resume — broadcasts spec, "Rate limit encountered mid-run" /
 * "Instance disconnected mid-run". Designed to run inside `after()`.
 *
 * The per-status count columns on `broadcasts` are owned by the DB
 * aggregate trigger (migrations 003/005): each recipient-row update
 * below advances them automatically. We therefore never write those
 * columns here — only the terminal `status` — otherwise a manual value
 * would race and clobber the trigger-maintained counts.
 */
export async function deliverBroadcast(
  db: SupabaseClient,
  plan: BroadcastPlan,
): Promise<void> {
  // Re-check connection fresh — time may have passed since createBroadcast
  // (or this is a resumed pass long after the original create). A
  // disconnected instance means nothing in this pass can send; leave
  // every recipient exactly as it is (still 'pending') for a resume.
  const { data: config } = await db
    .from("whatsapp_config")
    .select("connection_state")
    .eq("account_id", plan.accountId)
    .single();
  if (!config || config.connection_state !== "connected") {
    await finalizeBroadcastStatus(db, plan.broadcastId);
    return;
  }

  let media: { fileBase64: string; mimetype: string } | undefined;
  if (plan.mediaUrl && plan.mediaKind) {
    try {
      media = await fetchMediaAsBase64(plan.mediaUrl);
    } catch (err) {
      // Every recipient shares the same attachment — if it can't be
      // read, no send in this plan can succeed. Fail them all up front
      // rather than repeat the identical failure per recipient.
      const message =
        err instanceof Error
          ? err.message
          : "Could not read the broadcast attachment";
      for (const recipient of plan.planned) {
        await db
          .from("broadcast_recipients")
          .update({ status: "failed", error_message: message })
          .eq("id", recipient.recipientRowId);
      }
      await finalizeBroadcastStatus(db, plan.broadcastId);
      return;
    }
  }

  for (const recipient of plan.planned) {
    const text = substituteVariables(plan.messageBody, recipient.values);
    const variants = phoneVariants(recipient.phone);
    let sentMessageId: string | null = null;
    let lastError: string | null = null;
    let instanceTrouble = false;

    for (const variant of variants) {
      try {
        const result = await sendWithRateLimitBackoff(() =>
          media
            ? sendMediaMessage({
                token: plan.instanceToken,
                to: variant,
                kind: plan.mediaKind as MediaKind,
                fileBase64: media!.fileBase64,
                mimetype: media!.mimetype,
                caption: text || undefined,
                filename: plan.mediaFilename || undefined,
              })
            : sendTextMessage({ token: plan.instanceToken, to: variant, text }),
        );
        sentMessageId = result.messageId;
        lastError = null;
        break;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        lastError = message;
        if (isInstanceTrouble(error)) {
          instanceTrouble = true;
          break;
        }
        // Only a "recipient not allowed" error is worth another variant.
        if (!isRecipientNotAllowedError(message)) break;
      }
    }

    if (sentMessageId) {
      await db
        .from("broadcast_recipients")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          whatsapp_message_id: sentMessageId,
          error_message: null,
        })
        .eq("id", recipient.recipientRowId);
      continue;
    }

    if (instanceTrouble) {
      // Stop the whole pass here — this recipient and everyone after it
      // stay 'pending' rather than being marked failed.
      break;
    }

    await db
      .from("broadcast_recipients")
      .update({
        status: "failed",
        error_message: lastError || "Unknown error",
      })
      .eq("id", recipient.recipientRowId);
  }

  await finalizeBroadcastStatus(db, plan.broadcastId);
}

/**
 * Flip a broadcast out of `sending` once no recipient is left pending.
 *
 * Derived from the recipient rows rather than from a counter local to
 * one delivery pass: a resume (issue #472) delivers only the leftovers,
 * so "nothing sent *this* pass" must not mark a campaign failed when
 * 800 of its 1 000 recipients went out earlier. `failed` means every
 * single recipient failed; anything else that reached the gateway is
 * `sent`, with the per-recipient failures visible in `failed_count`.
 *
 * Per-status counts stay trigger-owned (migrations 003/005) — only the
 * terminal `status` is written here.
 */
export async function finalizeBroadcastStatus(
  db: SupabaseClient,
  broadcastId: string,
): Promise<void> {
  const countWhere = async (status: string): Promise<number> => {
    const { count } = await db
      .from("broadcast_recipients")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId)
      .eq("status", status);
    return count ?? 0;
  };

  // Still work outstanding (a capped resume pass, or a disconnected /
  // rate-limited pass that stopped early) — leave it 'sending' so the
  // UI keeps offering Resume.
  if ((await countWhere("pending")) > 0) return;

  const failed = await countWhere("failed");
  const { count: total } = await db
    .from("broadcast_recipients")
    .select("id", { count: "exact", head: true })
    .eq("broadcast_id", broadcastId);

  await db
    .from("broadcasts")
    .update({
      status: failed > 0 && failed === (total ?? 0) ? "failed" : "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", broadcastId);
}
