// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. sends via the UAZAPI gateway (with phone-variant retry +
//      contact auto-fix),
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic in the sense that it takes a `SupabaseClient`
// and an `accountId` and throws `SendMessageError` on failure. The
// callers own auth, rate-limiting, body parsing, and mapping the error
// to their respective response shapes (internal `{ error }` vs the v1
// envelope). Replaces the Meta Cloud API version of this file — see
// openspec/changes/replace-meta-with-uazapi/design.md D1.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendTextMessage,
  sendMediaMessage,
  sendInteractiveButtons,
  sendInteractiveList,
  assertMediaWithinInlineLimit,
  MediaTooLargeError,
  type MediaKind,
} from "@/lib/whatsapp/uazapi";
import { UazapiError } from "@/lib/whatsapp/uazapi-client";
import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from "@/lib/whatsapp/interactive";
import { decrypt } from "@/lib/whatsapp/encryption";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";

export const MEDIA_KINDS = ["image", "video", "document", "audio"] as const;
export const VALID_MESSAGE_TYPES = [
  "text",
  "interactive",
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "SendMessageError";
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
  /**
   * `messageType === 'audio'` only. When true the audio is sent as a
   * native WhatsApp voice message (PTT) rather than an audio-file
   * attachment. The persisted message is still `content_type: 'audio'`.
   * See whatsapp-messaging spec, "Composer voice recordings are sent as
   * native voice messages".
   */
  voice?: boolean;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** UAZAPI's `messageid` for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload. Exported so a caller can reject a malformed request
 * *before* it finds-or-creates a contact/conversation — otherwise an
 * invalid payload leaves an orphan empty conversation behind. The send
 * core calls this too, so validation can't be skipped.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, interactivePayload } = params;

  if (!messageType) {
    throw new SendMessageError("bad_request", "message_type is required", 400);
  }

  // Removed with the UAZAPI migration (design.md D5) — templates only
  // existed to satisfy Meta's approval requirement. Rejected by name
  // rather than falling through to the generic "unsupported type" 400
  // below, per whatsapp-messaging spec, "Template type is rejected".
  if (messageType === "template") {
    throw new SendMessageError(
      "template_removed",
      'Message type "template" is no longer supported — templates were removed. Send a free-form text or media message instead.',
      400,
    );
  }

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  if (!(VALID_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new SendMessageError(
      "bad_request",
      `Unsupported message_type "${messageType}"`,
      400,
    );
  }

  if (messageType === "text" && !contentText) {
    throw new SendMessageError(
      "bad_request",
      "content_text is required for text messages",
      400,
    );
  }

  // Interactive: validate the full structured payload against the
  // gateway's limits up front so a bad payload 400s before we touch it.
  if (messageType === "interactive") {
    const result = validateInteractivePayload(interactivePayload);
    if (!result.ok) {
      throw new SendMessageError("bad_request", result.error, 400);
    }
  }

  if (isMediaKind && !mediaUrl) {
    throw new SendMessageError(
      "bad_request",
      `media_url is required for ${messageType} messages`,
      400,
    );
  }

  // WhatsApp caps media captions at 1024 chars (audio carries none) —
  // a client-app rendering limit, not a Meta-specific one.
  if (
    isMediaKind &&
    messageType !== "audio" &&
    typeof contentText === "string" &&
    contentText.length > 1024
  ) {
    throw new SendMessageError(
      "bad_request",
      "Caption exceeds the 1024-character limit",
      400,
    );
  }
}

// ============================================================
// Outbound media — read the bytes back from `chat-media` (design.md D4)
// ============================================================

/**
 * Read outbound media bytes back from the `chat-media` object the
 * composer already uploaded and base64-encode them for UAZAPI's inline
 * `file` field — unlike Meta, UAZAPI has no pre-upload media-handle
 * flow, so the send core hands it the bytes directly rather than a link.
 *
 * Reads the object exactly once, up front (the caller must call this
 * BEFORE the phone-variant retry loop below — retrying a rejected
 * variant must not re-fetch). Enforces the inline-size ceiling on the
 * downloaded byte length before base64-encoding, per
 * `assertMediaWithinInlineLimit`'s own contract (base64 inflates size by
 * ~4/3, so checking the encoded string would let an oversized file
 * through) — see whatsapp-messaging spec, "Media over the limit".
 */
async function readOutboundMediaBase64(
  mediaUrl: string,
): Promise<{ fileBase64: string; mimetype: string }> {
  let response: Response;
  try {
    response = await fetch(mediaUrl);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new SendMessageError(
      "media_unresolvable",
      `Could not read the attachment: ${detail}`,
      502,
    );
  }
  if (!response.ok) {
    throw new SendMessageError(
      "media_unresolvable",
      `Could not read the attachment (storage responded ${response.status}).`,
      502,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    assertMediaWithinInlineLimit(bytes);
  } catch (err) {
    if (err instanceof MediaTooLargeError) {
      throw new SendMessageError("media_too_large", err.message, 400);
    }
    throw err;
  }

  return {
    fileBase64: Buffer.from(bytes).toString("base64"),
    mimetype:
      response.headers.get("content-type") || "application/octet-stream",
  };
}

// ============================================================
// Failure classification — whatsapp-messaging spec, "Send failures are
// surfaced with cause"
// ============================================================

/**
 * Map a thrown gateway/network failure onto a `SendMessageError` whose
 * `code` distinguishes an unauthenticated instance, a rate limit, and an
 * unexpected gateway fault — mirrors `/api/whatsapp/config`'s
 * `errorResponse` (unauthenticated means OUR stored instance token is
 * stale, not that the caller is unauthenticated, hence 502 rather than
 * 401). Never called for a recipient-unreachable failure — the retry
 * loop below classifies and throws that case directly, since it must
 * recognise the same failure text regardless of whether it arrived as a
 * `UazapiError` or a plain one.
 */
function toSendMessageError(err: unknown): SendMessageError {
  if (err instanceof UazapiError) {
    if (err.code === "rate_limited") {
      return new SendMessageError("rate_limited", err.message, 429);
    }
    if (err.code === "invalid_request") {
      return new SendMessageError("invalid_request", err.message, 400);
    }
    if (err.code === "unauthenticated") {
      return new SendMessageError("whatsapp_unauthenticated", err.message, 502);
    }
    return new SendMessageError("gateway_error", err.message, 502);
  }
  const message =
    err instanceof Error ? err.message : "Unknown WhatsApp gateway error";
  return new SendMessageError(
    "gateway_error",
    `WhatsApp gateway error: ${message}`,
    502,
  );
}

/**
 * Send a message in an existing conversation and persist it.
 *
 * `db` may be an RLS-scoped user client (dashboard) or the service-
 * role client (public API) — every query is filtered by `accountId`
 * either way, so tenancy holds regardless of which client is passed.
 */
export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams,
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    interactivePayload,
    replyToMessageId,
    voice,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      "bad_request",
      "conversation_id is required",
      400,
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    interactivePayload,
  });

  const isMediaKind = (MEDIA_KINDS as readonly string[]).includes(messageType);

  // Conversation + contact, account-scoped.
  const { data: conversation, error: convError } = await db
    .from("conversations")
    .select("*, contact:contacts(*)")
    .eq("id", conversationId)
    .eq("account_id", accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError("not_found", "Conversation not found", 404);
  }

  const contact = conversation.contact;
  if (!contact?.phone) {
    throw new SendMessageError(
      "bad_request",
      "Contact phone number not found",
      400,
    );
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw new SendMessageError(
      "bad_request",
      "Invalid phone number format",
      400,
    );
  }

  // WhatsApp config, account-scoped.
  const { data: config, error: configError } = await db
    .from("whatsapp_config")
    .select("instance_token, connection_state")
    .eq("account_id", accountId)
    .single();

  if (configError || !config || !config.instance_token) {
    throw new SendMessageError(
      "whatsapp_not_configured",
      "WhatsApp not configured. Please set up your WhatsApp integration first.",
      400,
    );
  }

  // Disconnected-instance check happens BEFORE any gateway call —
  // whatsapp-messaging spec, "Send failures are surfaced with cause"
  // (an unauthenticated or disconnected instance is its own category).
  if (config.connection_state !== "connected") {
    throw new SendMessageError(
      "whatsapp_disconnected",
      "WhatsApp is not connected. Reconnect from Settings → WhatsApp before sending messages.",
      400,
    );
  }

  const token = decrypt(config.instance_token);

  // Resolve the reply target to its gateway message id. The parent must
  // belong to this same conversation — otherwise a caller could quote
  // messages they can't see by guessing UUIDs.
  let replyToGatewayMessageId: string | undefined;
  if (replyToMessageId) {
    const { data: parent, error: parentError } = await db
      .from("messages")
      .select("message_id, conversation_id")
      .eq("id", replyToMessageId)
      .eq("conversation_id", conversationId)
      .maybeSingle();

    if (parentError || !parent) {
      throw new SendMessageError(
        "bad_request",
        "reply_to_message_id not found in this conversation",
        400,
      );
    }
    if (!parent.message_id) {
      console.warn(
        "[send-message] reply target has no gateway message_id; sending without context",
      );
    } else {
      replyToGatewayMessageId = parent.message_id;
    }
  }

  // Read the attachment back from `chat-media` ONCE, before the retry
  // loop below — see `readOutboundMediaBase64`'s doc comment.
  let media: { fileBase64: string; mimetype: string } | undefined;
  if (isMediaKind) {
    media = await readOutboundMediaBase64(mediaUrl!);
  }

  const attempt = async (phone: string): Promise<string> => {
    if (isMediaKind) {
      const result = await sendMediaMessage({
        token,
        to: phone,
        kind: messageType as MediaKind,
        fileBase64: media!.fileBase64,
        mimetype: media!.mimetype,
        caption: contentText || undefined,
        filename: filename || undefined,
        replyToMessageId: replyToGatewayMessageId,
        asVoiceNote: messageType === "audio" && voice === true,
      });
      return result.messageId;
    }
    if (messageType === "interactive") {
      const p = interactivePayload!;
      if (p.kind === "buttons") {
        const result = await sendInteractiveButtons({
          token,
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          replyToMessageId: replyToGatewayMessageId,
        });
        return result.messageId;
      }
      const result = await sendInteractiveList({
        token,
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        replyToMessageId: replyToGatewayMessageId,
      });
      return result.messageId;
    }
    const result = await sendTextMessage({
      token,
      to: phone,
      text: contentText!,
      replyToMessageId: replyToGatewayMessageId,
    });
    return result.messageId;
  };

  // Send via UAZAPI — retry across phone-number variants when the
  // gateway reports the recipient as unreachable (design.md D8: this is
  // a WhatsApp-numbering problem, e.g. the Brazilian ninth-digit dance,
  // not a Meta-specific one); persist a working variant back to the
  // contact so the next send goes straight through.
  let waMessageId = "";
  let workingPhone = sanitizedPhone;
  const variants = phoneVariants(sanitizedPhone);
  let lastError: unknown = null;
  let recipientUnreachable = false;

  for (const variant of variants) {
    try {
      waMessageId = await attempt(variant);
      workingPhone = variant;
      lastError = null;
      recipientUnreachable = false;
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(message)) {
        console.error("[send-message] WhatsApp send failed:", message);
        throw toSendMessageError(err);
      }
      lastError = err;
      recipientUnreachable = true;
      console.warn(
        `[send-message] variant "${variant}" rejected by the gateway, trying next…`,
      );
    }
  }

  if (lastError) {
    const failMessage =
      lastError instanceof Error ? lastError.message : String(lastError);
    console.error(
      "[send-message] WhatsApp send failed for every phone variant:",
      failMessage,
    );

    if (recipientUnreachable) {
      // Definitive, non-retryable failure — record it on the thread so
      // the agent sees the send failed rather than it vanishing with no
      // trace (whatsapp-messaging spec, "Recipient not on WhatsApp").
      // `messages` has no error-reason column (mirrors the webhook's own
      // `messages_update` handling, which only ever sets `status` —
      // see the callback route's `processStatusUpdate`); the reason
      // itself reaches the caller via the thrown error below.
      // Best-effort: a failure here must not hide the real cause.
      const { error: failInsertError } = await db.from("messages").insert({
        conversation_id: conversationId,
        sender_type: "agent",
        content_type: messageType,
        content_text:
          messageType === "interactive"
            ? interactivePayload!.body
            : (contentText ?? null),
        media_url: mediaUrl || null,
        status: "failed",
        reply_to_message_id: replyToMessageId || null,
      });
      if (failInsertError) {
        console.error(
          "[send-message] failed to record the failed send:",
          failInsertError.message,
        );
      }
      // Classified straight from the retry loop's own detection rather
      // than re-derived by `toSendMessageError` (which only recognises
      // `UazapiError`) — the gateway's failure may have arrived as a
      // plain `Error` and still be a recipient-unreachable case.
      throw new SendMessageError("recipient_unreachable", failMessage, 400);
    }

    throw toSendMessageError(lastError);
  }

  if (workingPhone !== sanitizedPhone) {
    console.log(
      `[send-message] Auto-corrected contact phone: ${sanitizedPhone} → ${workingPhone}`,
    );
    await db
      .from("contacts")
      .update({ phone: workingPhone })
      .eq("id", contact.id);
  }

  // Persist the sent message. Field names MUST match the messages
  // schema (see 001_initial_schema.sql).
  // Interactive messages persist the body as content_text (so the
  // conversation-list preview reads sensibly) plus the full structured
  // payload so the thread can re-render the buttons / rows.
  const persistedText =
    messageType === "interactive"
      ? interactivePayload!.body
      : (contentText ?? null);

  const { data: messageRecord, error: msgError } = await db
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_type: "agent",
      content_type: messageType,
      content_text: persistedText,
      media_url: mediaUrl || null,
      interactive_payload:
        messageType === "interactive" ? interactivePayload : null,
      message_id: waMessageId,
      status: "sent",
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error("[send-message] error inserting sent message:", msgError);
    throw new SendMessageError(
      "db_error",
      `Message sent via WhatsApp but failed to save to DB: ${msgError.message}`,
      500,
    );
  }

  const lastMessageText =
    messageType === "interactive"
      ? interactivePayloadPreviewText(interactivePayload!)
      : persistedText || `[${messageType}]`;

  await db
    .from("conversations")
    .update({
      last_message_text: lastMessageText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  // Pause any active Flow run for this contact — the agent stepping in
  // is the strongest "yield, human is here" signal. Best-effort.
  try {
    const { error: pauseErr } = await supabaseAdmin()
      .from("flow_runs")
      .update({
        status: "paused_by_agent",
        ended_at: new Date().toISOString(),
        end_reason: "agent_replied",
      })
      .eq("account_id", accountId)
      .eq("contact_id", contact.id)
      .eq("status", "active");
    if (pauseErr) {
      console.error("[flows] pause-on-agent-send failed:", pauseErr.message);
    }
  } catch (err) {
    console.error(
      "[flows] pause-on-agent-send threw:",
      err instanceof Error ? err.message : err,
    );
  }

  return { messageId: messageRecord.id, whatsappMessageId: waMessageId };
}
