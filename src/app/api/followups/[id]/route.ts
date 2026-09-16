import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  sendMessageToConversation,
  SendMessageError,
} from "@/lib/whatsapp/send-message";
import { followupReminderButtons } from "@/lib/followups/buttons";

type FollowupAction = "approve" | "reject" | "edit_and_send";

interface FollowupRow {
  id: string;
  status: string;
  conversation_id: string | null;
  body: string;
}

/**
 * POST /api/followups/[id]  (agent+)
 *
 * Body: `{ action: "approve" | "reject" | "edit_and_send", body?: string }`.
 *
 * design.md D7 — approve records the decision, THEN sends; the
 * conditional `UPDATE … WHERE status = 'pending'` is the concurrency
 * control (not a lock), matching `/api/flows/cron`'s `flow_runs`
 * pattern. Zero rows back means either the row isn't ours (treated
 * identically to a missing row — the inbox spec's "another account's
 * queue is invisible") or it was already decided.
 *
 * An `approve` retry (the row is already `approved` with a stale
 * `last_error` from a previous gateway failure) is NOT a second
 * decision — D7: "the row stays releasable" — so it skips the
 * pending-guard and re-sends the already-frozen body.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const action = body?.action as FollowupAction | undefined;
    if (!["approve", "reject", "edit_and_send"].includes(action ?? "")) {
      return NextResponse.json(
        { error: 'action must be "approve", "reject", or "edit_and_send"' },
        { status: 400 },
      );
    }
    if (action === "edit_and_send" && typeof body?.body !== "string") {
      return NextResponse.json(
        { error: "body is required for edit_and_send" },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    if (action === "reject") {
      const { data: rows, error } = await supabase
        .from("followup_messages")
        .update({ status: "rejected", decided_by: userId, decided_at: now })
        .eq("id", id)
        .eq("account_id", accountId)
        .eq("status", "pending")
        .select("id")
        .limit(1);
      if (error) {
        console.error("[followups] reject failed:", error.message);
        return NextResponse.json({ error: "Failed to reject" }, { status: 500 });
      }
      if (!rows?.length) return await conflictOrNotFound(supabase, id, accountId);
      return NextResponse.json({ id, status: "rejected" });
    }

    // approve / edit_and_send: claim the pending row (first decision)…
    const patch: Record<string, unknown> = {
      status: "approved",
      decided_by: userId,
      decided_at: now,
    };
    if (action === "edit_and_send") {
      patch.body = (body.body as string).trim();
    }

    const { data: decidedRows, error: decideErr } = await supabase
      .from("followup_messages")
      .update(patch)
      .eq("id", id)
      .eq("account_id", accountId)
      .eq("status", "pending")
      .select("id, conversation_id, body")
      .limit(1);
    if (decideErr) {
      console.error("[followups] approve failed:", decideErr.message);
      return NextResponse.json({ error: "Failed to approve" }, { status: 500 });
    }

    let followup: FollowupRow | null = decidedRows?.[0]
      ? { ...decidedRows[0], status: "approved" }
      : null;

    // …or, if it wasn't pending, this may be a retry of an already-
    // approved row whose send previously failed.
    if (!followup) {
      const { data: existing, error: fetchErr } = await supabase
        .from("followup_messages")
        .select("id, status, conversation_id, body")
        .eq("id", id)
        .eq("account_id", accountId)
        .maybeSingle();
      if (fetchErr) {
        console.error("[followups] lookup failed:", fetchErr.message);
        return NextResponse.json({ error: "Failed to approve" }, { status: 500 });
      }
      if (!existing) return notFoundResponse();
      if (existing.status !== "approved") return alreadyDecidedResponse();
      followup = existing as FollowupRow;
    }

    if (!followup.conversation_id) {
      await supabase
        .from("followup_messages")
        .update({ last_error: "No conversation on this follow-up" })
        .eq("id", followup.id);
      return NextResponse.json(
        { error: "This follow-up has no conversation to send to." },
        { status: 500 },
      );
    }

    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId: followup.conversation_id,
        messageType: "interactive",
        interactivePayload: {
          kind: "buttons",
          body: followup.body,
          buttons: followupReminderButtons(followup.id),
        },
      });
      await supabase
        .from("followup_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          whatsapp_message_id: result.whatsappMessageId,
          last_error: null,
        })
        .eq("id", followup.id);
      return NextResponse.json({ id: followup.id, status: "sent" });
    } catch (err) {
      const message =
        err instanceof SendMessageError ? err.message : "Failed to send the reminder";
      await supabase
        .from("followup_messages")
        .update({ last_error: message })
        .eq("id", followup.id);
      return NextResponse.json(
        { error: message, code: "send_failed" },
        { status: 502 },
      );
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}

function notFoundResponse() {
  return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
}

function alreadyDecidedResponse() {
  return NextResponse.json(
    {
      error: "This follow-up was already decided.",
      code: "already_decided",
    },
    { status: 409 },
  );
}

/**
 * After a failed conditional update, tell a genuinely-missing/other-
 * account row (404, no disclosure) apart from one that exists in this
 * account but is no longer pending (409 conflict).
 */
async function conflictOrNotFound(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  id: string,
  accountId: string,
) {
  const { data: existing } = await supabase
    .from("followup_messages")
    .select("id")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  return existing ? alreadyDecidedResponse() : notFoundResponse();
}
