import { sendTextMessage } from "@/lib/whatsapp/uazapi";
import type { InteractiveMessagePayload } from "@/lib/whatsapp/interactive";
import {
  engineSendInteractiveButtons,
  engineSendInteractiveList,
} from "@/lib/flows/uazapi-send";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";
import { supabaseAdmin } from "./admin-client";

// ------------------------------------------------------------
// Automation-side UAZAPI sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
//
// Replaces meta-send.ts at the UAZAPI migration (design.md D1). There
// is no `engineSendTemplate` any more — templates were removed
// outright (design.md D5); the `send_template` automation step is a
// dead, unsupported step_type now (see engine.ts / validate.ts).
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string;
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string;
  conversationId: string;
  contactId: string;
  text: string;
}

export async function engineSendText(
  args: SendTextArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin();

  // Scope the contact + config lookups by account_id, not user_id.
  // The engine uses the service-role client (bypassing RLS); without
  // this filter, an authenticated user could fire their own
  // automations against another tenant's contact UUID and send via
  // their own WhatsApp config to that contact's phone.
  const { data: contact, error: contactErr } = await db
    .from("contacts")
    .select("id, phone")
    .eq("id", args.contactId)
    .eq("account_id", args.accountId)
    .maybeSingle();
  if (contactErr || !contact?.phone) {
    throw new Error("contact not found for this account");
  }

  const sanitized = sanitizePhoneForMeta(contact.phone);
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`);
  }

  const { data: config, error: configErr } = await db
    .from("whatsapp_config")
    .select("instance_token, connection_state")
    .eq("account_id", args.accountId)
    .single();
  if (configErr || !config || !config.instance_token) {
    throw new Error("WhatsApp not configured for this account");
  }
  if (config.connection_state !== "connected") {
    throw new Error("WhatsApp is not connected for this account");
  }

  const token = decrypt(config.instance_token);

  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({ token, to: phone, text: args.text });
    return r.messageId;
  };

  // Phone-variant retry: numbers registered with/without a trunk 0
  // (design.md D8) both need this to reliably land a message.
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

  if (workingPhone !== sanitized) {
    await db
      .from("contacts")
      .update({ phone: workingPhone })
      .eq("id", contact.id);
  }

  // Persist the sent message so it appears in the inbox with a real
  // gateway message id. sender_type='bot' distinguishes automation
  // sends from manual agent sends.
  const { error: msgErr } = await db.from("messages").insert({
    conversation_id: args.conversationId,
    sender_type: "bot",
    content_type: "text",
    content_text: args.text,
    message_id: waMessageId,
    status: "sent",
  });
  if (msgErr) {
    // The gateway already has the message; record the DB error but
    // don't pretend the send failed. The engine wraps this in a log line.
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

interface SendInteractiveArgs {
  accountId: string;
  userId: string;
  conversationId: string;
  contactId: string;
  payload: InteractiveMessagePayload;
}

/**
 * Send an interactive (reply-buttons or list) message from the
 * automation engine.
 *
 * Delegates to the Flows interactive senders
 * (`engineSendInteractiveButtons` / `engineSendInteractiveList`), which
 * already own the account-scoped lookup, phone-variant retry, and the
 * `messages` insert with `interactive_payload` + `sender_type='bot'`.
 * Both engines want identical behaviour here, so there's one
 * implementation rather than a second hand-rolled copy that could drift.
 */
export async function engineSendInteractive(
  args: SendInteractiveArgs,
): Promise<{ whatsapp_message_id: string }> {
  const { payload, accountId, userId, conversationId, contactId } = args;
  const common = { accountId, userId, conversationId, contactId };
  if (payload.kind === "buttons") {
    return engineSendInteractiveButtons({
      ...common,
      bodyText: payload.body,
      headerText: payload.header,
      footerText: payload.footer,
      buttons: payload.buttons,
    });
  }
  return engineSendInteractiveList({
    ...common,
    bodyText: payload.body,
    buttonLabel: payload.button_label,
    headerText: payload.header,
    footerText: payload.footer,
    sections: payload.sections,
  });
}
