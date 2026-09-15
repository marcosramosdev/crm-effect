/**
 * UAZAPI WhatsApp gateway helpers.
 *
 * Replaces `meta-api.ts`. Every function still takes a single options
 * object (named parameters) — see `uazapi-client.ts` for why.
 *
 * Function names and result shapes deliberately mirror the old Meta
 * client (`sendTextMessage`, `sendMediaMessage`, `sendInteractiveButtons`,
 * `sendInteractiveList`, `sendReactionMessage`, `downloadMedia`) so the
 * call sites above this module change minimally. See design.md — D1.
 */

import { uazapiFetch } from "./uazapi-client";

export interface UazapiSendResult {
  /** UAZAPI's `messageid` — the WhatsApp-side id for the sent message. */
  messageId: string;
}

/**
 * Shape of a successful `/send/*` response: UAZAPI returns the created
 * `Message` row, plus a `response` envelope we don't otherwise need.
 */
interface UazapiMessageResponse {
  messageid: string;
}

// ============================================================
// Text
// ============================================================

export interface SendTextMessageArgs {
  /** Instance token — see whatsapp-connection spec. */
  token: string;
  /** Recipient in international format (no `+`), e.g. `5511999999999`. */
  to: string;
  text: string;
  /** UAZAPI message id being replied to — renders as a quoted reply. */
  replyToMessageId?: string;
}

/**
 * Send a free-form WhatsApp text message. Unlike Meta, there is no
 * 24-hour session-window restriction — see whatsapp-messaging spec,
 * "No session window restriction".
 */
export async function sendTextMessage(
  args: SendTextMessageArgs,
): Promise<UazapiSendResult> {
  const { token, to, text, replyToMessageId } = args;
  const body: Record<string, unknown> = { number: to, text };
  if (replyToMessageId) body.replyid = replyToMessageId;

  const data = await uazapiFetch<UazapiMessageResponse>({
    path: "/send/text",
    token,
    body,
  });
  return { messageId: data.messageid };
}

// ============================================================
// Media
// ============================================================

export type MediaKind = "image" | "video" | "document" | "audio";

const DEFAULT_MAX_INLINE_MEDIA_BYTES = 16 * 1024 * 1024; // 16 MB

/**
 * Thrown by `assertMediaWithinInlineLimit` — kept distinct from
 * `UazapiError` because this check runs entirely client-side, before
 * any gateway call, and callers (the send core, broadcasts) need to
 * catch it specifically rather than match on a message string.
 */
export class MediaTooLargeError extends Error {
  readonly actualBytes: number;
  readonly maxBytes: number;

  constructor(actualBytes: number, maxBytes: number) {
    super(
      `Media file is ${actualBytes} bytes, over the ${maxBytes}-byte inline send limit (UAZAPI_MAX_INLINE_MEDIA_BYTES).`,
    );
    this.name = "MediaTooLargeError";
    this.actualBytes = actualBytes;
    this.maxBytes = maxBytes;
  }
}

/** Configured ceiling, in bytes. Falls back to 16 MB on an unset or invalid value. */
export function maxInlineMediaBytes(): number {
  const raw = process.env.UAZAPI_MAX_INLINE_MEDIA_BYTES?.trim();
  if (!raw) return DEFAULT_MAX_INLINE_MEDIA_BYTES;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_INLINE_MEDIA_BYTES;
}

/**
 * Guard callers must run on the *raw* file bytes before base64-encoding
 * them — checking the encoded string would let a file ~25% over the
 * limit through (base64 inflates size by ~4/3).
 */
export function assertMediaWithinInlineLimit(bytes: Uint8Array): void {
  const limit = maxInlineMediaBytes();
  if (bytes.byteLength > limit) {
    throw new MediaTooLargeError(bytes.byteLength, limit);
  }
}

/**
 * Fetch a stored-media URL (e.g. a `chat-media`/`flow-media` object)
 * and base64-encode it for UAZAPI's inline `file` field — design.md D4:
 * the gateway has no pre-upload media-handle flow like Meta's, so every
 * outbound-media caller (send-message, broadcasts, flows, automations)
 * needs the same "fetch once, enforce the size ceiling on raw bytes,
 * then encode" sequence. Shared here so it's written once.
 *
 * Throws a plain `Error` — callers wrap it in whatever error type their
 * layer uses (e.g. `SendMessageError`, `BroadcastError`).
 */
export async function fetchMediaAsBase64(
  url: string,
): Promise<{ fileBase64: string; mimetype: string }> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read the attachment: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(
      `Could not read the attachment (storage responded ${response.status}).`,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  assertMediaWithinInlineLimit(bytes);

  return {
    fileBase64: Buffer.from(bytes).toString("base64"),
    mimetype:
      response.headers.get("content-type") || "application/octet-stream",
  };
}

export interface SendMediaMessageArgs {
  token: string;
  to: string;
  kind: MediaKind;
  /** Raw base64 content (no `data:` prefix) — see design.md D4. */
  fileBase64: string;
  mimetype: string;
  /** Caption / body text. UAZAPI accepts it on every media kind. */
  caption?: string;
  /** Document-only — shown as the file name in the recipient's chat. */
  filename?: string;
  replyToMessageId?: string;
  /**
   * Audio-only. When true, the audio is sent as a native WhatsApp voice
   * message (UAZAPI `type: "ptt"`) — a voice bubble with a waveform —
   * rather than an ordinary audio-file attachment (`type: "audio"`).
   * Ignored for non-audio kinds. A voice message carries no caption.
   */
  asVoiceNote?: boolean;
}

/**
 * Send an image, video, document, or audio message with the file
 * transmitted inline as base64 (design.md D4 — the gateway does not
 * offer a pre-upload media-handle flow like Meta's).
 *
 * Callers are responsible for enforcing the inline-size ceiling before
 * calling this (see `assertMediaWithinInlineLimit` in this module) —
 * this function does not read a file, it only sends bytes it is given.
 */
export async function sendMediaMessage(
  args: SendMediaMessageArgs,
): Promise<UazapiSendResult> {
  const {
    token,
    to,
    kind,
    fileBase64,
    mimetype,
    caption,
    filename,
    replyToMessageId,
    asVoiceNote,
  } = args;
  if (!fileBase64) throw new Error("sendMediaMessage requires fileBase64.");

  // A recorded voice note goes out as `ptt` (native voice bubble); an
  // ordinary audio-file attachment stays `audio`. `ptt` carries no
  // caption. See whatsapp-messaging spec, "Composer voice recordings
  // are sent as native voice messages".
  const isVoiceNote = kind === "audio" && asVoiceNote === true;

  const body: Record<string, unknown> = {
    number: to,
    type: isVoiceNote ? "ptt" : kind,
    file: fileBase64,
    mimetype,
  };
  if (caption && !isVoiceNote) body.text = caption;
  if (kind === "document" && filename) body.docName = filename;
  if (replyToMessageId) body.replyid = replyToMessageId;

  const data = await uazapiFetch<UazapiMessageResponse>({
    path: "/send/media",
    token,
    body,
  });
  return { messageId: data.messageid };
}

// ============================================================
// Interactive menus (buttons / lists)
// ============================================================

/**
 * Limits enforced before any `/send/menu` call. UAZAPI's OpenAPI spec
 * does not document numeric caps for this endpoint — these are
 * WhatsApp's own client-app rendering limits (the same phone app
 * renders the message regardless of which API sent it), so they are
 * carried over unchanged from the Meta client. See design.md D7.
 */
export const INTERACTIVE_LIMITS = {
  maxButtons: 3,
  buttonTitleMaxLength: 20,
  maxListSections: 10,
  maxListRowsTotal: 10,
  listRowTitleMaxLength: 24,
  listRowDescriptionMaxLength: 72,
  bodyMaxLength: 1024,
  footerMaxLength: 60,
  headerTextMaxLength: 60,
} as const;

/**
 * `/send/menu` encodes each choice as a single pipe-delimited string
 * (`"Label|payload"` or `"Label|payload|description"`). UAZAPI defines
 * no escape for a literal `|`, so any field containing one cannot be
 * expressed and is rejected up front rather than silently corrupting
 * the choice.
 */
function assertNoPipe(value: string, field: string): void {
  if (value.includes("|")) {
    throw new Error(`Interactive ${field} "${value}" may not contain "|".`);
  }
}

/**
 * `/send/menu` has no separate header slot the way Meta's interactive
 * messages did — only a single `text` field. A header is folded into
 * the body text (bold-header styling is lost, but the content still
 * reaches the customer) rather than silently dropped. Returns the
 * combined text that should be sent as `text`.
 */
function composeBodyWithHeader(
  bodyText: string,
  headerText: string | undefined,
): string {
  if (!bodyText) throw new Error("Interactive message requires bodyText.");
  if (
    headerText &&
    headerText.length > INTERACTIVE_LIMITS.headerTextMaxLength
  ) {
    throw new Error(
      `Interactive headerText exceeds ${INTERACTIVE_LIMITS.headerTextMaxLength} chars.`,
    );
  }
  const combined = headerText ? `${headerText}\n\n${bodyText}` : bodyText;
  if (combined.length > INTERACTIVE_LIMITS.bodyMaxLength) {
    throw new Error(
      `Interactive bodyText exceeds ${INTERACTIVE_LIMITS.bodyMaxLength} chars.`,
    );
  }
  return combined;
}

function validateFooter(footerText: string | undefined): void {
  if (footerText && footerText.length > INTERACTIVE_LIMITS.footerMaxLength) {
    throw new Error(
      `Interactive footerText exceeds ${INTERACTIVE_LIMITS.footerMaxLength} chars.`,
    );
  }
}

export interface InteractiveButton {
  /** Stable id sent back on the message when tapped. */
  id: string;
  /** Visible label. */
  title: string;
}

export interface SendInteractiveButtonsArgs {
  token: string;
  to: string;
  /** Body text — what the customer reads above the buttons. */
  bodyText: string;
  /**
   * Optional plain-text header. UAZAPI's `/send/menu` has no header
   * slot, so this is folded into `bodyText` — see
   * `composeBodyWithHeader`.
   */
  headerText?: string;
  /** Optional grey footer line under the buttons. */
  footerText?: string;
  /** 1–3 buttons. Validated against `INTERACTIVE_LIMITS` before sending. */
  buttons: InteractiveButton[];
  replyToMessageId?: string;
}

/**
 * Send an interactive message with up to 3 inline reply buttons. The
 * customer taps one and the selection's id arrives on the inbound
 * message as `buttonOrListid`.
 *
 * Validation throws BEFORE the network call so misconfigured flows
 * fail at save time, not during a live conversation.
 */
export async function sendInteractiveButtons(
  args: SendInteractiveButtonsArgs,
): Promise<UazapiSendResult> {
  const {
    token,
    to,
    bodyText,
    headerText,
    footerText,
    buttons,
    replyToMessageId,
  } = args;
  const text = composeBodyWithHeader(bodyText, headerText);
  validateFooter(footerText);
  if (buttons.length < 1 || buttons.length > INTERACTIVE_LIMITS.maxButtons) {
    throw new Error(
      `Interactive button message requires 1-${INTERACTIVE_LIMITS.maxButtons} buttons (got ${buttons.length}).`,
    );
  }
  const seenIds = new Set<string>();
  for (const btn of buttons) {
    if (!btn.id) throw new Error("Interactive button missing id.");
    if (seenIds.has(btn.id)) {
      throw new Error(
        `Interactive message has duplicate button id "${btn.id}".`,
      );
    }
    seenIds.add(btn.id);
    if (!btn.title)
      throw new Error(`Interactive button "${btn.id}" missing title.`);
    if (btn.title.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
      throw new Error(
        `Interactive button title "${btn.title}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`,
      );
    }
    assertNoPipe(btn.title, "button title");
    assertNoPipe(btn.id, "button id");
  }

  const body: Record<string, unknown> = {
    number: to,
    type: "button",
    text,
    choices: buttons.map((b) => `${b.title}|${b.id}`),
  };
  if (footerText) body.footerText = footerText;
  if (replyToMessageId) body.replyid = replyToMessageId;

  const data = await uazapiFetch<UazapiMessageResponse>({
    path: "/send/menu",
    token,
    body,
  });
  return { messageId: data.messageid };
}

export interface InteractiveListRow {
  /** Stable id sent back on the message when tapped. */
  id: string;
  /** Visible row title. */
  title: string;
  /** Optional secondary line shown under the title. */
  description?: string;
}

export interface InteractiveListSection {
  /** Optional section header shown above its rows. */
  title?: string;
  rows: InteractiveListRow[];
}

export interface SendInteractiveListArgs {
  token: string;
  to: string;
  bodyText: string;
  /**
   * Optional plain-text header. UAZAPI's `/send/menu` has no header
   * slot, so this is folded into `bodyText` — see
   * `composeBodyWithHeader`.
   */
  headerText?: string;
  /** Label of the tap-to-expand button on the message bubble. */
  buttonLabel: string;
  footerText?: string;
  /**
   * 1–10 rows TOTAL across all sections — WhatsApp caps the *total*,
   * not per-section.
   */
  sections: InteractiveListSection[];
  replyToMessageId?: string;
}

/**
 * Send an interactive message with a tap-to-expand list of selectable
 * rows. Use when there are more options than the 3-button limit
 * allows. The selected row's id arrives on the inbound message as
 * `buttonOrListid`.
 */
export async function sendInteractiveList(
  args: SendInteractiveListArgs,
): Promise<UazapiSendResult> {
  const {
    token,
    to,
    bodyText,
    headerText,
    buttonLabel,
    footerText,
    sections,
    replyToMessageId,
  } = args;
  const text = composeBodyWithHeader(bodyText, headerText);
  validateFooter(footerText);
  if (!buttonLabel) throw new Error("Interactive list requires a buttonLabel.");
  if (buttonLabel.length > INTERACTIVE_LIMITS.buttonTitleMaxLength) {
    throw new Error(
      `Interactive list buttonLabel "${buttonLabel}" exceeds ${INTERACTIVE_LIMITS.buttonTitleMaxLength} chars.`,
    );
  }
  assertNoPipe(buttonLabel, "buttonLabel");
  if (
    sections.length < 1 ||
    sections.length > INTERACTIVE_LIMITS.maxListSections
  ) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListSections} sections (got ${sections.length}).`,
    );
  }
  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows < 1 || totalRows > INTERACTIVE_LIMITS.maxListRowsTotal) {
    throw new Error(
      `Interactive list requires 1-${INTERACTIVE_LIMITS.maxListRowsTotal} rows total across all sections (got ${totalRows}).`,
    );
  }
  const seenIds = new Set<string>();
  const choices: string[] = [];
  for (const section of sections) {
    if (section.title) {
      assertNoPipe(section.title, "section title");
      choices.push(`[${section.title}]`);
    }
    for (const row of section.rows) {
      if (!row.id) throw new Error("Interactive list row missing id.");
      if (seenIds.has(row.id)) {
        throw new Error(`Interactive list has duplicate row id "${row.id}".`);
      }
      seenIds.add(row.id);
      if (!row.title)
        throw new Error(`Interactive list row "${row.id}" missing title.`);
      if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
        throw new Error(
          `Interactive list row title "${row.title}" exceeds ${INTERACTIVE_LIMITS.listRowTitleMaxLength} chars.`,
        );
      }
      if (
        row.description &&
        row.description.length > INTERACTIVE_LIMITS.listRowDescriptionMaxLength
      ) {
        throw new Error(
          `Interactive list row description for "${row.id}" exceeds ${INTERACTIVE_LIMITS.listRowDescriptionMaxLength} chars.`,
        );
      }
      assertNoPipe(row.title, "list row title");
      assertNoPipe(row.id, "list row id");
      if (row.description)
        assertNoPipe(row.description, "list row description");
      choices.push(
        row.description
          ? `${row.title}|${row.id}|${row.description}`
          : `${row.title}|${row.id}`,
      );
    }
  }

  const body: Record<string, unknown> = {
    number: to,
    type: "list",
    text,
    listButton: buttonLabel,
    choices,
  };
  if (footerText) body.footerText = footerText;
  if (replyToMessageId) body.replyid = replyToMessageId;

  const data = await uazapiFetch<UazapiMessageResponse>({
    path: "/send/menu",
    token,
    body,
  });
  return { messageId: data.messageid };
}

// ============================================================
// Reactions
// ============================================================

export interface SendReactionMessageArgs {
  token: string;
  to: string;
  /** UAZAPI message id of the message being reacted to. */
  targetMessageId: string;
  /** Single emoji, or empty string to remove an existing reaction. */
  emoji: string;
}

/**
 * Send a reaction (or removal) to a previously-exchanged message.
 * Empty `emoji` removes the reaction, matching UAZAPI's spec.
 *
 * No return value: unlike a text/media send, UAZAPI's response echoes
 * the *target* message id back rather than minting a new one for the
 * reaction, so there is nothing meaningful to persist as "the sent
 * message's id" (mirrors the Meta client's caller, which never used
 * the result either — see `src/app/api/whatsapp/react/route.ts`).
 */
export async function sendReactionMessage(
  args: SendReactionMessageArgs,
): Promise<void> {
  const { token, to, targetMessageId, emoji } = args;
  await uazapiFetch({
    path: "/message/react",
    token,
    body: { number: to, id: targetMessageId, text: emoji },
  });
}

// ============================================================
// Inbound media download
// ============================================================

export interface DownloadMessageMediaArgs {
  token: string;
  /** UAZAPI `messageid` of the inbound media message. */
  messageId: string;
}

export interface DownloadedMessageMedia {
  /** Public URL the gateway serves the file from — see design.md D4. */
  fileUrl: string;
  mimeType: string;
}

/**
 * Resolve the file for an inbound media message to a public URL, ready
 * for the inbound mirror job (`mirror-inbound-media.ts`) to fetch and
 * copy into Supabase storage.
 *
 * Unlike Meta's two-step media-proxy flow (resolve a short-lived
 * authenticated CDN URL, then fetch it with a bearer token), UAZAPI
 * does both in one call and hands back a URL that needs no auth header
 * to fetch — `return_base64: false` keeps the response small since we
 * only need the URL here, not the bytes.
 */
export async function downloadMessageMedia(
  args: DownloadMessageMediaArgs,
): Promise<DownloadedMessageMedia> {
  const { token, messageId } = args;
  const data = await uazapiFetch<{ fileURL?: string; mimetype?: string }>({
    path: "/message/download",
    token,
    body: { id: messageId, return_link: true, return_base64: false },
  });
  if (!data.fileURL) {
    throw new Error(
      `UAZAPI did not return a fileURL for message ${messageId}.`,
    );
  }
  return {
    fileUrl: data.fileURL,
    mimeType: data.mimetype || "application/octet-stream",
  };
}

// ============================================================
// Delivery-status mapping — design.md D6
// ============================================================

/** Matches `messages.status` (migration 001) plus `pending`, UAZAPI's `Queued`. */
export type MessageDeliveryStatus =
  "pending" | "sent" | "delivered" | "read" | "failed";

/** Forward-only ladder. `failed` is a terminal side branch, not on it. */
const STATUS_LADDER: readonly MessageDeliveryStatus[] = [
  "pending",
  "sent",
  "delivered",
  "read",
];

/** Maps a raw UAZAPI `Message.status` string onto our status vocabulary. */
export function mapUazapiMessageStatus(
  raw: string,
): MessageDeliveryStatus | null {
  switch (raw) {
    case "Queued":
      return "pending";
    case "Sent":
      return "sent";
    case "Delivered":
      return "delivered";
    case "Read":
      return "read";
    case "Failed":
    case "Canceled":
      return "failed";
    default:
      return null;
  }
}

/**
 * Decide whether an incoming raw UAZAPI status should overwrite a
 * message's currently stored status.
 *
 * Returns the status to persist, or `null` when the update must be
 * ignored: an unrecognised raw status, a regression to an earlier
 * point on the ladder, or any update once the message is already
 * `failed` (terminal). `failed` itself always wins over any non-failed
 * current status — see design.md D6.
 */
export function nextMessageStatus(
  current: MessageDeliveryStatus | null | undefined,
  rawIncoming: string,
): MessageDeliveryStatus | null {
  const incoming = mapUazapiMessageStatus(rawIncoming);
  if (!incoming) return null;
  if (current === "failed") return null;
  if (incoming === "failed") return "failed";
  if (!current) return incoming;

  const currentIndex = STATUS_LADDER.indexOf(current);
  const incomingIndex = STATUS_LADDER.indexOf(incoming);
  if (currentIndex < 0) return incoming;
  return incomingIndex > currentIndex ? incoming : null;
}
