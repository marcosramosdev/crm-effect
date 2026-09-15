// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body:
//   {
//     "to": "+14155550123",                 // required, E.164
//     "type": "text",                        // text|image|video|document|audio|voice (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio/voice
//     "filename": "invoice.pdf",             // optional, document filename
//     "voice": true,                         // optional; audio only — send as a native
//                                            //   WhatsApp voice message (PTT). `type: "voice"`
//                                            //   is shorthand for `type: "audio", voice: true`.
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe"                     // optional, names a newly-created contact
//   }
//
// `type: "template"` is rejected with a `template_removed` validation
// error — message templates were removed outright (design.md D5).
// Send free-form text or media instead.
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created" } }
// ============================================================

import { requireApiKey } from "@/lib/auth/api-context";
import { ok, fail, toApiErrorResponse } from "@/lib/api/v1/respond";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from "@/lib/whatsapp/send-message";
import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive";

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, "messages:send");

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return fail("bad_request", "Request body must be a JSON object", 400);
    }

    const to = typeof body.to === "string" ? body.to.trim() : "";
    if (!to) {
      return fail("bad_request", "'to' is required", 400);
    }

    const rawType = typeof body.type === "string" ? body.type : "text";
    // `type: "voice"` is ergonomic shorthand for an audio send delivered
    // as a native voice message. Normalise it to the real message type
    // plus the `voice` flag so validation and the send core only ever
    // see the supported `audio` type.
    const isVoiceAlias = rawType === "voice";
    const type = isVoiceAlias ? "audio" : rawType;
    const voice = body.voice === true || isVoiceAlias;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    // `type: "template"` is rejected here (template_removed) — see
    // whatsapp-messaging spec, "Template type is rejected".
    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === "object"
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === "string" ? body.text : null,
      mediaUrl: typeof body.media_url === "string" ? body.media_url : null,
      interactivePayload,
    });

    // Find-or-create the conversation for this phone, then send. Both
    // steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope.
    const resolved = await resolveConversationByPhone(
      ctx.supabase,
      ctx.accountId,
      to,
      typeof body.name === "string" ? body.name : null,
    );

    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: type,
        contentText: typeof body.text === "string" ? body.text : null,
        mediaUrl: typeof body.media_url === "string" ? body.media_url : null,
        filename: typeof body.filename === "string" ? body.filename : null,
        interactivePayload,
        replyToMessageId:
          typeof body.reply_to_message_id === "string"
            ? body.reply_to_message_id
            : null,
        voice,
      },
    );

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
      },
      201,
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
