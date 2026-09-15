import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from "@/lib/whatsapp/send-message";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";

// The dashboard's outbound-send endpoint. It owns auth, per-user rate
// limiting, and the three ways the UI targets a thread — an existing
// `conversation_id` (inbox), a `contact_id` (Contact detail →
// find-or-create the conversation), or a bare `to` phone number
// (start-a-conversation dialog → find-or-create the contact AND the
// conversation, reusing the public API's `resolveConversationByPhone`).
// The actual gateway plumbing (validate → send → persist → pause flows)
// lives in the shared `sendMessageToConversation` core, which the public
// `/api/v1/messages` endpoint reuses. This route is a thin adapter:
// resolve the conversation, delegate, then map `SendMessageError` back
// onto the dashboard's internal `{ error }` shape.
export async function POST(request: Request) {
  try {
    // Requires the 'agent' role, matching both `canSendMessages` and the
    // `messages_modify` RLS policy (migration 017).
    //
    // Resolving `account_id` off the profile — which any 'viewer' has —
    // was previously the only gate. RLS did block the message INSERT, but
    // the send core calls Meta BEFORE it persists, so a viewer's request
    // still delivered a real WhatsApp message to the customer and merely
    // failed to record it (surfacing as "sent to Meta but failed to save
    // to DB"). RLS can't un-send that, so the role check belongs here.
    const { supabase, accountId, userId } = await requireRole("agent");

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget. A `to` (phone) target is
    // not a new budget — it shares this bucket.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const {
      // `conversation_id` targets an existing thread (inbox). `contact_id`
      // lets a caller initiate from a contact that may have no conversation
      // yet (Contact detail → Send message). `to` is a bare phone number
      // for a recipient that may have no contact yet (start-a-conversation
      // dialog) — we find-or-create both the contact and the conversation.
      conversation_id: conversationIdInput,
      contact_id,
      to,
      name,
      message_type,
      content_text,
      media_url,
      filename,
      interactive_payload,
      reply_to_message_id,
      // Audio only: send as a native voice message (PTT) rather than an
      // audio-file attachment. See whatsapp-messaging spec.
      voice,
    } = body;

    // Exactly one target. Supplying two (or none) is a 400 rather than a
    // precedence rule, so a client bug surfaces immediately instead of
    // silently messaging the wrong thread (design.md D6).
    const targetCount = [conversationIdInput, contact_id, to].filter(
      (v) => typeof v === "string" && v.trim() !== "",
    ).length;
    if (targetCount !== 1 || !message_type) {
      return NextResponse.json(
        {
          error:
            "Exactly one of conversation_id, contact_id, or to, plus message_type, are required",
        },
        { status: 400 },
      );
    }

    // Validate the message shape up front — before the contact_id / to
    // paths find-or-create anything — so an invalid payload 400s without
    // leaving an orphan empty contact or conversation behind.
    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        interactivePayload: interactive_payload,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      throw err;
    }

    // Resolve the target conversation.
    let conversationId: string | null = null;
    // Set only on the `to` path — records what THIS request created so a
    // failed cold send can be rolled back without touching anything that
    // pre-existed or that arrived in the meantime (design.md D5).
    let phoneResolution: {
      contactId: string;
      contactCreated: boolean;
      conversationId: string;
      conversationCreated: boolean;
    } | null = null;

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationIdInput)
        .eq("account_id", accountId)
        .single();

      if (convError || !data) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      conversationId = data.id;
    } else if (contact_id) {
      // contact_id path: verify the contact is in this account first so a
      // caller can't open a conversation against someone else's contact.
      const { data: contactRow, error: contactErr } = await supabase
        .from("contacts")
        .select("id")
        .eq("id", contact_id)
        .eq("account_id", accountId)
        .maybeSingle();

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: "Contact not found" },
          { status: 404 },
        );
      }

      const resolved = await findOrCreateConversation(
        supabase,
        accountId,
        userId,
        contact_id,
      );
      if (!resolved) {
        return NextResponse.json(
          { error: "Failed to open a conversation for this contact" },
          { status: 500 },
        );
      }
      conversationId = resolved;
    } else {
      // `to` (phone) path: find-or-create the contact + conversation with
      // the exact dedupe rules the public API and webhook share.
      // `resolveConversationByPhone` throws `SendMessageError` for a
      // malformed number (400) or a missing WhatsApp config (400).
      try {
        const resolved = await resolveConversationByPhone(
          supabase,
          accountId,
          to,
          typeof name === "string" ? name : null,
        );
        conversationId = resolved.conversationId;
        phoneResolution = {
          contactId: resolved.contactId,
          contactCreated: resolved.contactCreated,
          conversationId: resolved.conversationId,
          conversationCreated: resolved.conversationCreated,
        };
      } catch (err) {
        if (err instanceof SendMessageError) {
          return NextResponse.json(
            { error: err.message },
            { status: err.status },
          );
        }
        throw err;
      }
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    // Delegate to the shared send core (validates, sends via UAZAPI with
    // phone-variant retry, persists, pauses active flow runs). Its
    // `SendMessageError` carries a machine code + HTTP status; the
    // dashboard maps it to the internal `{ error }` shape.
    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
        voice: voice === true,
      });

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: conversationId,
        ...(phoneResolution
          ? {
              contact_id: phoneResolution.contactId,
              contact_created: phoneResolution.contactCreated,
            }
          : {}),
      });
    } catch (err) {
      // A cold first send that failed: undo the contact / conversation
      // this request created, so "compose and send" leaves no residue on
      // failure (spec: "Failed send creates nothing"). Guarded so an
      // inbound message or an auto-created deal that landed in the gap is
      // never destroyed — see design.md D5.
      if (phoneResolution) {
        await rollbackPhoneResolution(supabase, accountId, phoneResolution);
      }
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      throw err;
    }
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error("Error in WhatsApp send POST:", error);
    return toErrorResponse(error);
  }
}

type SendSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a single
 * thread per contact. Runs under the caller's RLS — the conversations_insert
 * policy requires account agent membership, which the caller already is.
 */
async function findOrCreateConversation(
  supabase: SendSupabase,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
    })
    .select("id")
    .single();

  if (error) {
    console.error(
      "Error creating conversation for contact send:",
      error.message,
    );
    return null;
  }

  return created.id;
}

/**
 * Compensating delete for a failed `to` (phone) send. Only ever removes
 * rows THIS request created (`*Created` flags), and only when doing so is
 * a no-op against anything real:
 *
 *   - the conversation is deleted only if it still holds no messages —
 *     an inbound message that attached itself in the gap keeps it;
 *   - the contact is deleted only if it has no remaining conversations
 *     AND no deals — migration 041's default-pipeline seeding can have
 *     created one.
 *
 * A residual orphan contact (no conversation) is preferred over
 * destroying real inbound data. Failures here are logged and swallowed;
 * the caller still returns the original send error.
 */
async function rollbackPhoneResolution(
  supabase: SendSupabase,
  accountId: string,
  info: {
    contactId: string;
    contactCreated: boolean;
    conversationId: string;
    conversationCreated: boolean;
  },
): Promise<void> {
  try {
    if (info.conversationCreated) {
      const { count: messageCount } = await supabase
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", info.conversationId);

      if (!messageCount) {
        await supabase
          .from("conversations")
          .delete()
          .eq("id", info.conversationId)
          .eq("account_id", accountId);
      }
    }

    if (info.contactCreated) {
      const [{ count: convCount }, { count: dealCount }] = await Promise.all([
        supabase
          .from("conversations")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", info.contactId),
        supabase
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("contact_id", info.contactId),
      ]);

      if (!convCount && !dealCount) {
        await supabase
          .from("contacts")
          .delete()
          .eq("id", info.contactId)
          .eq("account_id", accountId);
      }
    }
  } catch (err) {
    console.error(
      "[whatsapp/send] phone-resolution rollback failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
