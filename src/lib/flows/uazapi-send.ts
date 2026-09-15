import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  fetchMediaAsBase64,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from "@/lib/whatsapp/uazapi";
import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";
import { supabaseAdmin } from "./admin-client";

// ------------------------------------------------------------
// Flows-side UAZAPI sender (interactive variants).
//
// Mirrors src/lib/automations/uazapi-send.ts (engineSendText) but emits
// interactive button + list messages, plus media. Kept separate from
// the automations file so the two engines don't fight over each
// other's shape — once both stabilize, the phone-variant retry + DB
// persistence are obvious extraction candidates into a shared base.
//
// Replaces meta-send.ts at the UAZAPI migration — see
// openspec/changes/replace-meta-with-uazapi/design.md D1.
// ------------------------------------------------------------

interface WhatsappConfigRow {
  instance_token: string;
  connection_state: string;
}

async function loadConnectedConfig(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
): Promise<{ token: string }> {
  const { data: config, error: configErr } = await db
    .from("whatsapp_config")
    .select("instance_token, connection_state")
    .eq("account_id", accountId)
    .single();
  if (configErr || !config || !(config as WhatsappConfigRow).instance_token) {
    throw new Error("WhatsApp not configured for this account");
  }
  const row = config as WhatsappConfigRow;
  if (row.connection_state !== "connected") {
    throw new Error("WhatsApp is not connected for this account");
  }
  return { token: decrypt(row.instance_token) };
}

async function loadContactPhone(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  contactId: string,
): Promise<{ id: string; sanitizedPhone: string }> {
  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select("id, phone")
    .eq("id", contactId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (contactErr || !contact?.phone) {
    throw new Error("contact not found for this account");
  }
  const sanitized = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`);
  }
  return { id: contact.id, sanitizedPhone: sanitized };
}

/** Retry across phone-number variants; only a recipient-unreachable
 *  failure is worth another variant. Returns the gateway message id and
 *  the phone variant that actually worked. */
async function attemptWithPhoneVariants(
  sanitized: string,
  attempt: (phone: string) => Promise<string>,
): Promise<{ waMessageId: string; workingPhone: string }> {
  const variants = phoneVariants(sanitized);
  let workingPhone = sanitized;
  let waMessageId = "";
  let lastError: unknown = null;
  for (const v of variants) {
    try {
      waMessageId = await attempt(v);
      workingPhone = v;
      lastError = null;
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(msg)) throw err;
      lastError = err;
    }
  }
  if (lastError) throw lastError;
  return { waMessageId, workingPhone };
}

interface SendTextEngineArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so a flow authored by user A still sends through the
   *  WhatsApp number user B saved on the same account. */
  accountId: string;
  /** Original author of the flow — used for INSERT audit columns
   *  and for resolving the agent's identity in logs. Not consulted
   *  for tenancy. */
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
  /** Marks the persisted message row `ai_generated = true` so the inbox
   *  badges it as an AI reply. Only the auto-reply bot sets this;
   *  deterministic Flow/automation sends leave it false. */
  aiGenerated?: boolean;
}

/**
 * Send a plain-text WhatsApp message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin();

  const { id: contactRowId, sanitizedPhone } = await loadContactPhone(
    db,
    args.accountId,
    args.contactId,
  );
  const { token } = await loadConnectedConfig(db, args.accountId);

  const { waMessageId, workingPhone } = await attemptWithPhoneVariants(
    sanitizedPhone,
    (phone) =>
      sendTextMessage({ token, to: phone, text: args.text }).then(
        (r) => r.messageId,
      ),
  );

  if (workingPhone !== sanitizedPhone) {
    await db
      .from("contacts")
      .update({ phone: workingPhone })
      .eq("id", contactRowId);
  }

  const { error: msgErr } = await db.from("messages").insert({
    conversation_id: args.conversationId,
    sender_type: "bot",
    content_type: "text",
    content_text: args.text,
    message_id: waMessageId,
    status: "sent",
    ai_generated: args.aiGenerated ?? false,
  });
  if (msgErr) {
    throw new Error(
      `sent via WhatsApp but DB insert failed: ${msgErr.message}`,
    );
  }

  await db
    .from("conversations")
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);

  return { whatsapp_message_id: waMessageId };
}

interface SendMediaEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  kind: MediaKind;
  /** Public URL (e.g. `flow-media` storage) fetched and inlined as base64. */
  link: string;
  caption?: string;
  /** Document-only; ignored for image/video. */
  filename?: string;
}

/**
 * Send an image / video / document from the Flows engine.
 *
 * Used by the runner's `send_media` node. Auto-advances after the
 * send lands (same suspend semantics as send_message). Unlike Meta,
 * UAZAPI has no pre-upload media-handle flow (design.md D4) — the
 * file at `link` is fetched and base64-encoded here before sending.
 */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin();

  const { id: contactRowId, sanitizedPhone } = await loadContactPhone(
    db,
    args.accountId,
    args.contactId,
  );
  const { token } = await loadConnectedConfig(db, args.accountId);
  const { fileBase64, mimetype } = await fetchMediaAsBase64(args.link);

  const { waMessageId, workingPhone } = await attemptWithPhoneVariants(
    sanitizedPhone,
    (phone) =>
      sendMediaMessage({
        token,
        to: phone,
        kind: args.kind,
        fileBase64,
        mimetype,
        caption: args.caption,
        filename: args.filename,
      }).then((r) => r.messageId),
  );

  if (workingPhone !== sanitizedPhone) {
    await db
      .from("contacts")
      .update({ phone: workingPhone })
      .eq("id", contactRowId);
  }

  // content_type='image'|'video'|'document' — these are already in the
  // messages_content_type_check constraint (migration 001 + 010).
  const { error: msgErr } = await db.from("messages").insert({
    conversation_id: args.conversationId,
    sender_type: "bot",
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: "sent",
  });
  if (msgErr) {
    throw new Error(
      `sent via WhatsApp but DB insert failed: ${msgErr.message}`,
    );
  }

  const preview = args.caption?.trim() || `[${args.kind}]`;
  await db
    .from("conversations")
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.conversationId);

  return { whatsapp_message_id: waMessageId };
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  bodyText: string;
  buttons: InteractiveButton[];
  headerText?: string;
  footerText?: string;
}

interface SendInteractiveListEngineArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  bodyText: string;
  buttonLabel: string;
  sections: InteractiveListSection[];
  headerText?: string;
  footerText?: string;
}

/**
 * Send an interactive-button WhatsApp message from the Flows engine.
 *
 * Persists the outgoing message to `messages` with
 * `content_type='interactive'` and `sender_type='bot'` so the inbox
 * surfaces it with the "Button reply" affordance and the conversation
 * thread reflects the bot's prompt.
 *
 * Returns the gateway message id so the caller (engine) can stash it on
 * the `flow_runs.last_prompt_message_id` field for later reference.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaUazapi({ ...args, kind: "buttons" });
}

/**
 * Send an interactive-list WhatsApp message from the Flows engine.
 * Used when the flow needs more than 3 options (WhatsApp's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaUazapi({ ...args, kind: "list" });
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: "buttons" })
  | (SendInteractiveListEngineArgs & { kind: "list" });

async function sendInteractiveViaUazapi(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin();

  const { id: contactRowId, sanitizedPhone } = await loadContactPhone(
    db,
    input.accountId,
    input.contactId,
  );
  const { token } = await loadConnectedConfig(db, input.accountId);

  const { waMessageId, workingPhone } = await attemptWithPhoneVariants(
    sanitizedPhone,
    (phone) => {
      if (input.kind === "buttons") {
        return sendInteractiveButtons({
          token,
          to: phone,
          bodyText: input.bodyText,
          buttons: input.buttons,
          headerText: input.headerText,
          footerText: input.footerText,
        }).then((r) => r.messageId);
      }
      return sendInteractiveList({
        token,
        to: phone,
        bodyText: input.bodyText,
        buttonLabel: input.buttonLabel,
        sections: input.sections,
        headerText: input.headerText,
        footerText: input.footerText,
      }).then((r) => r.messageId);
    },
  );

  if (workingPhone !== sanitizedPhone) {
    await db
      .from("contacts")
      .update({ phone: workingPhone })
      .eq("id", contactRowId);
  }

  // Persist the bot's prompt to the messages table so it appears in
  // the inbox. We do NOT set interactive_reply_id here — that column is
  // reserved for the customer's tap on this message, populated by the
  // webhook when their reply arrives. We DO persist the structured
  // payload so the inbox thread re-renders the buttons/rows the bot
  // sent, matching the composer + automation send paths.
  const interactivePayload: InteractiveMessagePayload =
    input.kind === "buttons"
      ? {
          kind: "buttons",
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: "list",
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        };

  const { error: msgErr } = await db.from("messages").insert({
    conversation_id: input.conversationId,
    sender_type: "bot",
    content_type: "interactive",
    content_text: input.bodyText,
    interactive_payload: interactivePayload,
    message_id: waMessageId,
    status: "sent",
  });
  if (msgErr) {
    throw new Error(
      `sent via WhatsApp but DB insert failed: ${msgErr.message}`,
    );
  }

  await db
    .from("conversations")
    .update({
      last_message_text: input.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId);

  return { whatsapp_message_id: waMessageId };
}
