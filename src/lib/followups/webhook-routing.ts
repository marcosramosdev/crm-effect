// ============================================================
// Inbound button-reply routing — design.md D8/D9.
//
// Called from the WhatsApp webhook AFTER its duplicate-insert early
// return and the `bump_conversation_on_inbound` RPC, so a gateway
// redelivery never reaches this code (exactly-once for free), and
// alongside — never instead of — the existing flow/automation
// dispatch (it never sets `flowConsumed`). The caller wraps this in
// its own try/catch: a follow-up bookkeeping failure must never cost
// the account the inbound message itself.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseFollowupButtonId } from "./buttons";

interface RouteArgs {
  accountId: string;
  conversationId: string;
  interactiveReplyId: string | null | undefined;
}

export async function routeFollowupButtonReply(
  db: SupabaseClient,
  args: RouteArgs,
): Promise<void> {
  const parsed = parseFollowupButtonId(args.interactiveReplyId);
  if (!parsed) return; // not a follow-up button — typed text, or an unrelated flow/automation reply.

  const { data: followup, error } = await db
    .from("followup_messages")
    .select("id, account_id, deal_id")
    .eq("id", parsed.followupId)
    .maybeSingle();
  if (error) throw error;
  // A reminder belonging to another account (or one that no longer
  // exists) is ignored for routing — inbox spec delta, "another
  // account's queue is invisible".
  if (!followup || followup.account_id !== args.accountId) return;

  if (parsed.action === "confirm") {
    await confirmAppointment(db, followup.deal_id as string);
    return;
  }
  await notifyReschedule(db, args.accountId, args.conversationId);
}

/**
 * Confirm: stamp `deals.appointment_confirmed_at` idempotently, and
 * flag — not decide — the deal's remaining pending reminders. A
 * repeated confirm is harmless: the deal stamp only ever writes once
 * (`.is("appointment_confirmed_at", null)`), and re-flagging an
 * already-flagged row is a no-op update.
 */
async function confirmAppointment(db: SupabaseClient, dealId: string): Promise<void> {
  await db
    .from("deals")
    .update({ appointment_confirmed_at: new Date().toISOString() })
    .eq("id", dealId)
    .is("appointment_confirmed_at", null);

  await db
    .from("followup_messages")
    .update({ appointment_confirmed: true })
    .eq("deal_id", dealId)
    .eq("status", "pending");
}

/**
 * Reschedule: notify every account member with agent permission or
 * above, carrying the conversation id so the notifications page can
 * open the thread. Touches no deal column — the appointment time only
 * ever moves when a person edits the deal (D10).
 */
async function notifyReschedule(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<void> {
  const { data: members, error } = await db
    .from("profiles")
    .select("user_id")
    .eq("account_id", accountId)
    .in("account_role", ["agent", "admin", "owner"]);
  if (error) throw error;
  if (!members || members.length === 0) return;

  await db.from("notifications").insert(
    (members as { user_id: string }[]).map((m) => ({
      account_id: accountId,
      user_id: m.user_id,
      type: "followup_reschedule",
      conversation_id: conversationId,
      title: "Lead solicitou reagendamento",
      body: "O lead respondeu ao lembrete pedindo para reagendar o horário.",
    })),
  );
}
