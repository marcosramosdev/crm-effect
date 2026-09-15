import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  hashWebhookSecret,
  normalizeConnectionState,
} from "@/lib/whatsapp/instance";
import {
  nextMessageStatus,
  type MessageDeliveryStatus,
} from "@/lib/whatsapp/uazapi";
import {
  resolveInboundMedia,
  mapMediaKind,
  normalizeMessageType,
} from "@/lib/whatsapp/inbound-media";
import { normalizePhone } from "@/lib/whatsapp/phone-utils";
import { findExistingContact, isUniqueViolation } from "@/lib/contacts/dedupe";
import { reopenClosedConversation } from "@/lib/conversations/reopen";
import { runAutomationsForTrigger } from "@/lib/automations/engine";
import { dispatchInboundToFlows } from "@/lib/flows/engine";
import { dispatchInboundToAiReply } from "@/lib/ai/auto-reply";
import { dispatchWebhookEvent } from "@/lib/webhooks/deliver";

/**
 * UAZAPI webhook callback — see design.md D3 and the whatsapp-connection
 * / whatsapp-messaging specs.
 *
 * Replaces `/api/whatsapp/webhook` (Meta's HMAC-signed, phone-number-ID
 * routed callback). UAZAPI signs nothing, so the route moves to
 * `/api/whatsapp/webhook/[secret]`: the path segment IS the auth — an
 * unguessable per-account secret generated on connect (`instance.ts`,
 * `ensureWebhookRegistered`) and looked up here by its SHA-256 hash, so
 * a wrong guess costs the same indexed lookup as a right one.
 *
 * There is no GET handler — Meta's `hub.challenge` verify-token dance
 * has no UAZAPI equivalent (task 4.2).
 */

// See the Meta-era route this replaces for why `after()` is required
// here rather than a detached promise: on serverless platforms the
// function can be frozen the moment the response is sent, which
// dropped a non-deterministic subset of inbound messages (issue #301).
export const maxDuration = 60;

// Lazy-initialized to avoid build-time crash when env vars are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

// ============================================================
// UAZAPI event envelope (WebhookEvent schema) + Message shape
// (uazapi-openapi-spec.yaml — see design.md context section)
// ============================================================

/**
 * The real UAZAPI callback envelope. The gateway's OpenAPI `WebhookEvent`
 * schema (`{ event: string, instance, data }`) does NOT match what it
 * actually POSTs. Observed shape (see design.md D1):
 *
 *   {
 *     "EventType": "messages" | "messages_update" | "connection" | ...,
 *     "message":   { ...payload... },   // present when EventType === "messages"
 *     "event":     { ...payload... },   // present for "messages_update" (and others)
 *     "chat":      { ... },             // extra context on "messages", unused here
 *     "instanceName": "...", "token": "...", "owner": "...", "BaseUrl": "..."
 *   }
 *
 * So the event-type field is `EventType` (not `event`), and the payload
 * lives under `message` or `event` depending on the type — `event` is an
 * OBJECT here, not the type string the old code read. `extractEnvelope()`
 * below normalizes this (with a fallback to the idealized
 * `{ event: string, data }` shape in case a deployment differs).
 */
interface UazapiWebhookBody {
  EventType?: string;
  /** Payload for `EventType: "messages"`. */
  message?: unknown;
  /** Payload for `EventType: "messages_update"` and others; legacy: type string. */
  event?: unknown;
  /** Legacy/idealized payload key. */
  data?: unknown;
  instanceName?: string;
  /** Legacy instance-id key. */
  instance?: string;
  token?: string;
  owner?: string;
}

/** Normalized `{ type, data, instance }` triple the handlers below operate on. */
interface NormalizedEvent {
  type: string | undefined;
  data: unknown;
  instance: string | undefined;
}

/**
 * Pull the event type and its payload out of the real envelope, tolerating
 * both the observed shape (`EventType` + `message`/`event`) and the
 * idealized `{ event: string, data }` shape the OpenAPI spec documents.
 */
function extractEnvelope(body: UazapiWebhookBody): NormalizedEvent {
  const type =
    body.EventType ?? (typeof body.event === "string" ? body.event : undefined);
  const data =
    body.message ??
    body.data ??
    (body.event && typeof body.event === "object" ? body.event : undefined);
  return { type, data, instance: body.instanceName ?? body.instance };
}

/**
 * `EventType` values come from UAZAPI's `WebhookConfig.events` enum, kept
 * in `WEBHOOK_EVENTS` (src/lib/whatsapp/instance.ts). The `message` /
 * `status` aliases are defensive — the OpenAPI `WebhookEvent.event` enum
 * lists those singular spellings even though the gateway was observed
 * sending the plural `messages` / `messages_update`. Keep this map and
 * `WEBHOOK_EVENTS` in lockstep. See design.md D1/D2.
 */
type WebhookEventCategory = "inbound" | "status" | "connection";

export function normalizeWebhookEventType(
  raw: string | undefined,
): WebhookEventCategory | null {
  switch ((raw ?? "").toLowerCase()) {
    case "message":
    case "messages":
      return "inbound";
    case "messages_update":
    case "status":
      return "status";
    case "connection":
      return "connection";
    default:
      return null;
  }
}

/** Subset of the `Message` schema this route reads. */
interface UazapiMessage {
  messageid?: string;
  chatid?: string;
  sender?: string;
  senderName?: string;
  isGroup?: boolean;
  fromMe?: boolean;
  messageType?: string;
  /** Epoch MILLISECONDS (Message schema — unlike Meta's epoch seconds). */
  messageTimestamp?: number;
  status?: string;
  text?: string;
  /** Message id being replied to, when this message is a quoted reply. */
  quoted?: string;
  /** Message id being reacted to, when this message is a reaction. */
  reaction?: string;
  buttonOrListid?: string;
  error?: string;
}

interface ConfigRow {
  id: string;
  account_id: string;
  user_id: string;
  instance_token: string | null;
  connection_state: string;
  paired_phone: string | null;
  paired_at: string | null;
  mirror_inbound_media: boolean | null;
  /** Opt-in default pipeline for contacts this webhook creates (migration 041). */
  inbound_default_pipeline_id: string | null;
  inbound_default_stage_id: string | null;
}

const CONFIG_COLUMNS =
  "id, account_id, user_id, instance_token, connection_state, paired_phone, paired_at, mirror_inbound_media, inbound_default_pipeline_id, inbound_default_stage_id";

async function resolveConfigBySecret(
  secret: string,
): Promise<ConfigRow | null> {
  const hash = hashWebhookSecret(secret);
  const { data, error } = await supabaseAdmin()
    .from("whatsapp_config")
    .select(CONFIG_COLUMNS)
    .eq("webhook_secret_hash", hash)
    .maybeSingle();
  if (error) {
    console.error("[webhook] config lookup failed:", error.message);
    return null;
  }
  return (data as ConfigRow | null) ?? null;
}

// ============================================================
// POST — receive UAZAPI events
// ============================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;
  if (!secret) {
    return NextResponse.json(
      { error: "Missing webhook secret" },
      { status: 401 },
    );
  }

  const config = await resolveConfigBySecret(secret);
  if (!config) {
    // 401 (not 200) — mirrors the old signature check: a misconfigured
    // or rotated-away secret should be loud, not silently swallowed.
    console.warn("[webhook] rejected request with unrecognised secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  let body: UazapiWebhookBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Acknowledge — a malformed body must not trigger redelivery storms.
    console.warn("[webhook] body was not valid JSON");
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  const evt = extractEnvelope(body);
  if (!evt.type || !evt.data || typeof evt.data !== "object") {
    // Not a recognizable event envelope (no type, or no payload object).
    // Acked so the gateway doesn't retry; logged with the keys we did
    // get so a shape change is diagnosable rather than silent.
    console.warn("[webhook] unrecognized envelope", {
      keys: Object.keys(body),
      eventType: evt.type,
    });
    return NextResponse.json({ status: "ignored" }, { status: 200 });
  }

  // Process AFTER the response so we ack within the gateway's own
  // delivery timeout, while still guaranteeing the work runs to
  // completion — see the module doc comment.
  after(async () => {
    try {
      await processEvent(evt, config);
    } catch (error) {
      console.error("[webhook] error processing event:", error);
    }
  });

  return NextResponse.json({ status: "received" }, { status: 200 });
}

async function processEvent(evt: NormalizedEvent, config: ConfigRow) {
  const category = normalizeWebhookEventType(evt.type);
  const dataKeys =
    evt.data && typeof evt.data === "object"
      ? Object.keys(evt.data as Record<string, unknown>)
      : typeof evt.data;

  switch (category) {
    case "inbound":
      console.info("[webhook] handling inbound event", {
        eventType: evt.type,
        account_id: config.account_id,
      });
      await processMessage(evt.data as UazapiMessage, config);
      return;
    case "status":
      console.info("[webhook] handling status event", {
        eventType: evt.type,
        account_id: config.account_id,
      });
      await processStatusUpdate(evt.data as UazapiMessage, config);
      return;
    case "connection":
      console.info("[webhook] handling connection event", {
        eventType: evt.type,
        account_id: config.account_id,
      });
      await processConnectionEvent(evt.data, config);
      return;
    default:
      // A well-formed envelope whose event type this app takes no action
      // on (presence, groups, call, history, …). Acknowledged by the 200
      // already sent; logged — rather than silently swallowed — so an
      // unexpected gateway event name is diagnosable. See the
      // whatsapp-messaging spec, "Recognized envelope with an unhandled
      // event type".
      console.warn("[webhook] unhandled event type", {
        eventType: evt.type,
        instance: evt.instance,
        dataKeys,
      });
      return;
  }
}

// ============================================================
// `connection` events — whatsapp-connection spec, "Connection state
// is observable and persisted"
// ============================================================

async function processConnectionEvent(data: unknown, config: ConfigRow) {
  if (!data || typeof data !== "object") return;
  const payload = data as {
    instance?: { status?: string; lastDisconnectReason?: string };
    status?: string;
    lastDisconnectReason?: string;
    jid?: { user?: string } | null;
  };
  // The `connection` event's exact data shape isn't spelled out in the
  // OpenAPI spec beyond "varies by event type" (design.md context), so
  // this tolerates both a nested `instance.status` (matching
  // `GET /instance/status`) and a flat `status` at the top level.
  const instanceStatus = payload.instance?.status ?? payload.status;
  const disconnectReason =
    payload.instance?.lastDisconnectReason ??
    payload.lastDisconnectReason ??
    "";
  const newState = normalizeConnectionState(instanceStatus);

  const wasConnected = config.connection_state === "connected";
  const nowConnected = newState === "connected";
  const jidUser = payload.jid?.user;
  const pairedPhone =
    nowConnected && jidUser ? jidUser.replace(/\D/g, "") : config.paired_phone;
  const pairedAt =
    nowConnected && !wasConnected ? new Date().toISOString() : config.paired_at;

  // A logged-out session invalidates the paired credentials entirely —
  // treat it like an explicit reset (whatsapp-connection spec, "Reset
  // to pair a different number") so the settings UI offers a fresh QR
  // rather than a "reconnect" that can never succeed, instead of the
  // passive "Gateway reports a disconnection" scenario, which only
  // updates state. Task 4.9 deviation: UAZAPI's `connection` event
  // doesn't document a distinct "logged out" signal separately from a
  // transient disconnect, so this infers it from `lastDisconnectReason`
  // free text (`instance.yaml#Instance.lastDisconnectReason`), the same
  // field UAZAPI uses elsewhere to explain a disconnect.
  const loggedOut = !nowConnected && /logg?ed[\s-]?out/i.test(disconnectReason);

  const update: Record<string, unknown> = {
    connection_state: newState,
    updated_at: new Date().toISOString(),
    paired_phone: loggedOut ? null : pairedPhone,
    paired_at: loggedOut ? null : pairedAt,
  };

  const { error } = await supabaseAdmin()
    .from("whatsapp_config")
    .update(update)
    .eq("id", config.id);
  if (error) {
    console.error("[webhook] error updating connection state:", error.message);
  }
}

// ============================================================
// `messages_update` events — whatsapp-messaging spec, "Delivery-status
// updates"
// ============================================================

async function processStatusUpdate(msg: UazapiMessage, config: ConfigRow) {
  const messageId = msg?.messageid;
  const rawStatus = msg?.status;
  if (!messageId || !rawStatus) return;

  const tsIso = msg.messageTimestamp
    ? new Date(msg.messageTimestamp).toISOString()
    : new Date().toISOString();

  // 1) Mirror onto `messages`. Not `.select()`ed as a single row:
  //    message_id isn't unique across conversations (migration 009 —
  //    ids repeat across numbers), so this may match 0..N rows.
  const { data: msgRows, error: msgSelErr } = await supabaseAdmin()
    .from("messages")
    .select("id, status, conversation_id, conversations(account_id)")
    .eq("message_id", messageId)
    .limit(1);

  if (msgSelErr) {
    console.error("[webhook] status lookup failed:", msgSelErr.message);
  }
  const msgRow = (msgRows?.[0] ?? null) as {
    id: string;
    status: string;
    conversation_id: string;
    conversations: { account_id: string } | null;
  } | null;

  if (msgRow) {
    const newStatus = nextMessageStatus(
      msgRow.status as MessageDeliveryStatus,
      rawStatus,
    );
    // `messages.status`'s CHECK constraint (migration 001, untouched by
    // 040) allows sending|sent|delivered|read|failed — not `pending`,
    // which UAZAPI's `Queued` maps to (design.md D6). `Queued` is the
    // pre-transmission state and isn't expected to arrive as an update
    // event in practice; guarded anyway rather than let a constraint
    // violation surface as a logged DB error on every such event.
    if (newStatus && newStatus !== "pending") {
      const { error } = await supabaseAdmin()
        .from("messages")
        .update({ status: newStatus })
        .eq("message_id", messageId);
      if (error) {
        console.error(
          "[webhook] error updating message status:",
          error.message,
        );
      }
    }
  }

  // 2) Mirror onto broadcast_recipients via whatsapp_message_id
  //    (migration 003). The aggregate trigger re-derives the parent
  //    broadcast's sent/delivered/read/failed counts automatically.
  const { data: recipient, error: recFetchErr } = await supabaseAdmin()
    .from("broadcast_recipients")
    .select("id, status")
    .eq("whatsapp_message_id", messageId)
    .maybeSingle();

  if (recFetchErr) {
    console.error(
      "[webhook] error fetching broadcast recipient:",
      recFetchErr.message,
    );
  } else if (recipient) {
    // `replied` sits above this ladder entirely (set by
    // flagBroadcastReplyIfAny, not by a gateway status event) — skip
    // rather than let nextMessageStatus's unknown-current fallback
    // ("accept anything") regress a replied recipient back to
    // delivered/read on a late status echo.
    if (recipient.status !== "replied") {
      const newRecipientStatus = nextMessageStatus(
        recipient.status as MessageDeliveryStatus,
        rawStatus,
      );
      if (newRecipientStatus) {
        const update: Record<string, unknown> = { status: newRecipientStatus };
        if (newRecipientStatus === "sent") update.sent_at = tsIso;
        if (newRecipientStatus === "delivered") update.delivered_at = tsIso;
        if (newRecipientStatus === "read") update.read_at = tsIso;
        if (newRecipientStatus === "failed" && msg.error)
          update.error_message = msg.error;

        const { error } = await supabaseAdmin()
          .from("broadcast_recipients")
          .update(update)
          .eq("id", recipient.id);
        if (error) {
          console.error(
            "[webhook] error updating broadcast recipient status:",
            error.message,
          );
        }
      }
    }
  }

  // 3) Webhook fan-out for messages we store (inbox / API sends). Runs
  //    last so a slow subscriber can't delay the mirrors above. An
  //    unknown message id (no row in either table) reaches here having
  //    written nothing — spec: "Update for an unknown message".
  if (msgRow) {
    // Falls back to the webhook's own resolved account on the rare
    // chance the join comes back empty — the tenant is otherwise fully
    // determined by the message's own conversation, not by which
    // account's secret happened to receive this event.
    const accountId = msgRow.conversations?.account_id ?? config.account_id;
    if (accountId) {
      await dispatchWebhookEvent(
        supabaseAdmin(),
        accountId,
        "message.status_updated",
        {
          whatsapp_message_id: messageId,
          conversation_id: msgRow.conversation_id,
          status: rawStatus,
        },
      );
    }
  }
}

// ============================================================
// `message` events — whatsapp-messaging spec, "Inbound message
// ingestion"
// ============================================================

/** Strips a JID's `@suffix` (e.g. `5511999999999@s.whatsapp.net` -> `5511999999999`). */
function jidUser(jid: string): string {
  const at = jid.indexOf("@");
  return at >= 0 ? jid.slice(0, at) : jid;
}

function jidSuffix(jid: string): string {
  const at = jid.indexOf("@");
  return at >= 0 ? jid.slice(at + 1) : "";
}

// Compared against `normalizeMessageType(...)` output, so the proto-style
// `ExtendedTextMessage` collapses to `extendedtext` here.
const TEXT_MESSAGE_TYPES = new Set([
  "text",
  "chat",
  "conversation",
  "extendedtext",
  "",
]);

async function processMessage(msg: UazapiMessage, config: ConfigRow) {
  if (!msg || !msg.messageid || !msg.chatid) return;

  // Self-sent echo. The webhook registration already excludes
  // wasSentByApi (instance.ts, ensureWebhookRegistered), but this is
  // the belt-and-suspenders filter design.md D3 calls for in case that
  // filter is ever misconfigured on the gateway side.
  if (msg.fromMe) return;

  // Group and channel chats are dropped at the ingest boundary
  // (design.md D8; whatsapp-messaging spec, "Group and channel
  // messages are ignored"). `isGroup` covers groups; the JID suffix
  // covers channels, which aren't flagged by `isGroup`.
  const suffix = jidSuffix(msg.chatid);
  if (msg.isGroup || suffix === "g.us" || suffix === "newsletter") return;

  const senderPhone = normalizePhone(jidUser(msg.chatid));
  if (!senderPhone) return;

  const contactOutcome = await findOrCreateContact(
    config.account_id,
    config.user_id,
    senderPhone,
    msg.senderName || senderPhone,
  );
  if (!contactOutcome) return;
  const contact = contactOutcome.contact;

  // Opt-in: a contact this webhook just created is dropped into the
  // account's configured default pipeline as a fresh deal. Best-effort —
  // must never break ingestion (whatsapp-messaging spec, "New inbound
  // contacts join the configured default pipeline").
  if (contactOutcome.wasCreated) {
    await seedDefaultPipelineDeal(config, contact, senderPhone);
  }

  const convResult = await findOrCreateConversation(
    config.account_id,
    config.user_id,
    contact.id,
  );
  if (!convResult) return;
  const conversation = convResult.conversation;

  // Emitted before the reaction short-circuit so a conversation first
  // opened by a reaction still fires conversation.created.
  if (convResult.created) {
    await dispatchWebhookEvent(
      supabaseAdmin(),
      config.account_id,
      "conversation.created",
      {
        conversation_id: conversation.id,
        contact_id: contact.id,
      },
    );
  }

  // Reactions aren't messages — never inserted into `messages`, never
  // bump unread_count / last_message_text.
  const isReaction =
    normalizeMessageType(msg.messageType) === "reaction" ||
    Boolean(msg.reaction);
  if (isReaction) {
    await handleReaction(msg, conversation.id, contact.id);
    return;
  }

  const { contentText, mediaUrl, mediaType, interactiveReplyId } =
    await parseMessageContent(msg, config);

  let replyToInternalId: string | null = null;
  if (msg.quoted) {
    replyToInternalId = await lookupInternalIdByMessageId(
      msg.quoted,
      conversation.id,
    );
    if (!replyToInternalId) {
      console.warn("[webhook] reply context parent not found:", msg.quoted);
    }
  }

  const contentType = mapContentType(msg.messageType, interactiveReplyId);

  const { count: priorCustomerMsgCount } = await supabaseAdmin()
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversation.id)
    .eq("sender_type", "customer");
  const isFirstInboundMessage = (priorCustomerMsgCount ?? 0) === 0;

  const createdAt = msg.messageTimestamp
    ? new Date(msg.messageTimestamp).toISOString()
    : new Date().toISOString();

  // Idempotent insert — the gateway can redeliver, and each redelivery
  // replays the exact same messageid. The unique index on
  // (conversation_id, message_id) (migration 037) makes a replay
  // conflict; ignoreDuplicates turns that into ON CONFLICT DO NOTHING,
  // and `.select()` returns the row ONLY on a genuine first insert.
  const { data: insertedRows, error: msgError } = await supabaseAdmin()
    .from("messages")
    .upsert(
      {
        conversation_id: conversation.id,
        sender_type: "customer",
        content_type: contentType,
        content_text: contentText,
        media_url: mediaUrl,
        media_type: mediaType,
        message_id: msg.messageid,
        status: "delivered",
        created_at: createdAt,
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: interactiveReplyId,
      },
      { onConflict: "conversation_id,message_id", ignoreDuplicates: true },
    )
    .select("id");

  if (msgError) {
    console.error("[webhook] error inserting message:", msgError);
    return;
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info(
      "[webhook] duplicate inbound message ignored (idempotent replay):",
      msg.messageid,
    );
    return;
  }

  const { error: convError } = await supabaseAdmin().rpc(
    "bump_conversation_on_inbound",
    {
      p_conversation_id: conversation.id,
      p_last_message_text: contentText || `[${msg.messageType || "message"}]`,
    },
  );
  if (convError) {
    console.error("[webhook] error updating conversation:", convError);
  }

  await reopenClosedConversation(supabaseAdmin(), conversation);
  await flagBroadcastReplyIfAny(config.account_id, contact.id);

  const flowResult = await dispatchInboundToFlows({
    accountId: config.account_id,
    userId: config.user_id,
    contactId: contact.id,
    conversationId: conversation.id,
    message: interactiveReplyId
      ? {
          kind: "interactive_reply",
          reply_id: interactiveReplyId,
          reply_title: contentText ?? "",
          meta_message_id: msg.messageid,
        }
      : {
          kind: "text",
          text: contentText ?? msg.text ?? "",
          meta_message_id: msg.messageid,
        },
    isFirstInboundMessage,
  });
  const flowConsumed = flowResult.consumed;

  const inboundText = contentText ?? msg.text ?? "";
  const automationTriggers: (
    | "new_contact_created"
    | "first_inbound_message"
    | "new_message_received"
    | "keyword_match"
    | "interactive_reply"
  )[] = [];
  if (!flowConsumed) {
    automationTriggers.push("new_message_received", "keyword_match");
    if (interactiveReplyId) {
      automationTriggers.push("interactive_reply");
    }
  }
  if (contactOutcome.wasCreated)
    automationTriggers.unshift("new_contact_created");
  if (isFirstInboundMessage)
    automationTriggers.unshift("first_inbound_message");
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId: config.account_id,
      triggerType,
      contactId: contact.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error("[automations] dispatch failed:", err));
  }

  if (!flowConsumed && !interactiveReplyId && inboundText.trim()) {
    await dispatchInboundToAiReply({
      accountId: config.account_id,
      conversationId: conversation.id,
      contactId: contact.id,
      configOwnerUserId: config.user_id,
    });
  }

  await dispatchWebhookEvent(
    supabaseAdmin(),
    config.account_id,
    "message.received",
    {
      conversation_id: conversation.id,
      contact_id: contact.id,
      whatsapp_message_id: msg.messageid,
      content_type: contentType,
      text: contentText,
    },
  );
}

/** Maps a raw `messageType` onto the `messages.content_type` CHECK vocabulary. */
function mapContentType(
  rawType: string | undefined,
  interactiveReplyId: string | null,
): string {
  if (interactiveReplyId) return "interactive";
  const mediaKind = mapMediaKind(rawType);
  if (mediaKind) return mediaKind;
  if (normalizeMessageType(rawType) === "location") return "location";
  return "text";
}

async function parseMessageContent(
  msg: UazapiMessage,
  config: ConfigRow,
): Promise<{
  contentText: string | null;
  mediaUrl: string | null;
  mediaType: string | null;
  interactiveReplyId: string | null;
}> {
  const empty = {
    contentText: null as string | null,
    mediaUrl: null as string | null,
    mediaType: null as string | null,
    interactiveReplyId: null as string | null,
  };

  // A button/list tap. Independent of messageType — design.md D7: the
  // selection's stable id always arrives on buttonOrListid.
  if (msg.buttonOrListid) {
    return {
      ...empty,
      contentText: msg.text || msg.buttonOrListid,
      interactiveReplyId: msg.buttonOrListid,
    };
  }

  // Normalised so the gateway's proto-style spellings (`ImageMessage`,
  // `LocationMessage`, `ExtendedTextMessage`, …) collapse onto the bare
  // tokens the branches below match on.
  const rawType = normalizeMessageType(msg.messageType);
  const mediaKind = mapMediaKind(rawType);

  if (mediaKind && msg.messageid) {
    const { mediaUrl, mediaType } = await resolveInboundMedia({
      storage: supabaseAdmin().storage,
      accountId: config.account_id,
      messageId: msg.messageid,
      encryptedInstanceToken: config.instance_token,
      // Default ON: the column is NOT NULL DEFAULT TRUE, but a row read
      // before migration 039 landed could have it undefined, and
      // losing attachments is the failure mode worth avoiding.
      mirrorEnabled: config.mirror_inbound_media !== false,
      messageTimestamp: msg.messageTimestamp,
    });
    return { ...empty, contentText: msg.text || null, mediaUrl, mediaType };
  }

  if (rawType === "location") {
    return { ...empty, contentText: msg.text || "[Location]" };
  }

  if (TEXT_MESSAGE_TYPES.has(rawType)) {
    return { ...empty, contentText: msg.text || null };
  }

  // Genuinely unrecognised: persist as text with a diagnostic body and
  // log the received type so a gateway sending a new spelling is
  // diagnosable rather than silently degraded (whatsapp-messaging spec,
  // "Genuinely unknown message type").
  console.warn(
    "[webhook] unrecognised inbound messageType; persisting as text placeholder:",
    msg.messageType || "unknown",
  );
  return {
    ...empty,
    contentText: `[Unsupported message type: ${msg.messageType || "unknown"}]`,
  };
}

/**
 * Persist an inbound reaction. Reactions are not new messages — they're
 * per-(target, actor) state. Upsert / delete on `message_reactions`,
 * never write a row into `messages`. Best-effort: a missing parent (we
 * never received it) is logged and skipped so the webhook still acks.
 */
async function handleReaction(
  msg: UazapiMessage,
  conversationId: string,
  contactId: string,
) {
  const targetMessageId = msg.reaction;
  if (!targetMessageId) return;

  const targetInternalId = await lookupInternalIdByMessageId(
    targetMessageId,
    conversationId,
  );
  if (!targetInternalId) {
    console.warn(
      "[webhook] reaction target message not found; skipping",
      targetMessageId,
    );
    return;
  }

  // Empty text = removal, mirroring the outbound convention
  // (sendReactionMessage / POST /message/react).
  const emoji = msg.text || "";
  if (!emoji) {
    const { error } = await supabaseAdmin()
      .from("message_reactions")
      .delete()
      .eq("message_id", targetInternalId)
      .eq("actor_type", "customer")
      .eq("actor_id", contactId);
    if (error) {
      console.error("[webhook] reaction delete failed:", error.message);
    }
    return;
  }

  const { error } = await supabaseAdmin().from("message_reactions").upsert(
    {
      message_id: targetInternalId,
      conversation_id: conversationId,
      actor_type: "customer",
      actor_id: contactId,
      emoji,
    },
    { onConflict: "message_id,actor_type,actor_id" },
  );
  if (error) {
    console.error("[webhook] reaction upsert failed:", error.message);
  }
}

/**
 * Resolve a provider-side message id into the matching internal UUID,
 * scoped to one conversation. Returns null when we never received the
 * parent (e.g. a swipe-reply to a message older than this CRM install).
 */
async function lookupInternalIdByMessageId(
  messageId: string,
  conversationId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin()
    .from("messages")
    .select("id")
    .eq("message_id", messageId)
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) {
    console.error(
      "[webhook] lookupInternalIdByMessageId failed:",
      error.message,
    );
    return null;
  }
  return data?.id ?? null;
}

/**
 * If an inbound message's sender is on a still-unreplied
 * broadcast_recipients row, flip it to `replied` so the reply count
 * advances on the parent broadcast. Best-effort — failures here must
 * not break the main inbound-message flow.
 */
async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from("broadcast_recipients")
      .select("id, status, broadcast_id, broadcasts!inner(account_id)")
      .eq("contact_id", contactId)
      .eq("broadcasts.account_id", accountId)
      .in("status", ["sent", "delivered", "read"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !recs || recs.length === 0) return;

    const row = recs[0];
    const { error: updErr } = await supabaseAdmin()
      .from("broadcast_recipients")
      .update({ status: "replied", replied_at: new Date().toISOString() })
      .eq("id", row.id);
    if (updErr) {
      console.error(
        "[webhook] error marking broadcast recipient replied:",
        updErr,
      );
    }
  } catch (err) {
    console.error("[webhook] flagBroadcastReplyIfAny failed:", err);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ContactRow = any;

interface ContactOutcome {
  contact: ContactRow;
  wasCreated: boolean;
}

/**
 * Seed a deal for a just-created contact on the account's configured
 * default inbound pipeline (migration 041 columns on `whatsapp_config`).
 *
 * Opt-in: does nothing unless BOTH `inbound_default_pipeline_id` and
 * `inbound_default_stage_id` are set — the "both set" guard runs before
 * any query, so accounts without the setting pay nothing. A deleted
 * pipeline or stage nulls its column (ON DELETE SET NULL), so that case
 * lands here as "unset" too.
 *
 * Best-effort throughout: every failure is logged and swallowed so the
 * inbound message still persists and downstream dispatch still runs.
 */
async function seedDefaultPipelineDeal(
  config: ConfigRow,
  contact: ContactRow,
  fallbackTitle: string,
): Promise<void> {
  const pipelineId = config.inbound_default_pipeline_id;
  const stageId = config.inbound_default_stage_id;
  if (!pipelineId || !stageId) return;

  try {
    // Defensive: `wasCreated` already implies no prior deal, but a
    // create/redeliver race could get here twice.
    const { count, error: countErr } = await supabaseAdmin()
      .from("deals")
      .select("id", { count: "exact", head: true })
      .eq("contact_id", contact.id);
    if (countErr) {
      console.error(
        "[webhook] default-pipeline deal: existing-deal check failed:",
        countErr.message,
      );
      return;
    }
    if ((count ?? 0) > 0) return;

    // Match the account's configured currency, mirroring the
    // `create_deal` automation. Fall back to USD if unavailable.
    let currency = "USD";
    const { data: acct } = await supabaseAdmin()
      .from("accounts")
      .select("default_currency")
      .eq("id", config.account_id)
      .maybeSingle();
    if (acct?.default_currency) currency = acct.default_currency as string;

    const { error: insertErr } = await supabaseAdmin()
      .from("deals")
      .insert({
        account_id: config.account_id,
        user_id: config.user_id,
        pipeline_id: pipelineId,
        stage_id: stageId,
        contact_id: contact.id,
        title: contact.name || fallbackTitle,
        value: 0,
        currency,
        status: "open",
      });
    if (insertErr) {
      console.error(
        "[webhook] default-pipeline deal: insert failed:",
        insertErr.message,
      );
    }
  } catch (err) {
    console.error(
      "[webhook] default-pipeline deal: unexpected error:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function findOrCreateContact(
  accountId: string,
  configOwnerUserId: string,
  phone: string,
  name: string,
): Promise<ContactOutcome | null> {
  const existingContact = await findExistingContact(
    supabaseAdmin(),
    accountId,
    phone,
  );

  if (existingContact) {
    if (name && name !== existingContact.name) {
      await supabaseAdmin()
        .from("contacts")
        .update({ name, updated_at: new Date().toISOString() })
        .eq("id", existingContact.id);
    }
    return { contact: existingContact, wasCreated: false };
  }

  const { data: newContact, error: createError } = await supabaseAdmin()
    .from("contacts")
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      phone,
      name: name || phone,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const raced = await findExistingContact(
        supabaseAdmin(),
        accountId,
        phone,
      );
      if (raced) return { contact: raced, wasCreated: false };
    }
    console.error("[webhook] error creating contact:", createError);
    return null;
  }

  return { contact: newContact, wasCreated: true };
}

async function findOrCreateConversation(
  accountId: string,
  configOwnerUserId: string,
  contactId: string,
) {
  const { data: existingRows, error: findError } = await supabaseAdmin()
    .from("conversations")
    .select("*")
    .eq("account_id", accountId)
    .eq("contact_id", contactId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (findError) {
    console.error("[webhook] error finding conversation:", findError);
    return null;
  }

  if (existingRows && existingRows.length > 0) {
    return { conversation: existingRows[0], created: false };
  }

  const { data: newConv, error: createError } = await supabaseAdmin()
    .from("conversations")
    .insert({
      account_id: accountId,
      user_id: configOwnerUserId,
      contact_id: contactId,
    })
    .select()
    .single();

  if (createError) {
    if (isUniqueViolation(createError)) {
      const { data: raced } = await supabaseAdmin()
        .from("conversations")
        .select("*")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(1);
      if (raced && raced.length > 0) {
        return { conversation: raced[0], created: false };
      }
    }
    console.error("[webhook] error creating conversation:", createError);
    return null;
  }

  return { conversation: newConv, created: true };
}
