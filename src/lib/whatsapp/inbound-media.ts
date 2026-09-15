/**
 * Inbound media resolution for the UAZAPI webhook (design.md D4;
 * whatsapp-messaging spec, "Inbound media is downloaded and mirrored").
 *
 * Two failure tiers, each with its own fallback:
 *
 *   1. `POST /message/download` itself fails (gateway error, missing
 *      instance token, …) — we never get a URL at all. The text portion
 *      of the message is still persisted by the caller; media is
 *      marked unavailable. See spec scenario "Download failure".
 *   2. The download succeeds but `mirrorInboundMedia`'s own fetch-then-
 *      upload fails (Storage rejects the MIME, the bucket is down, …).
 *      We fall back to the gateway's own `fileURL` rather than losing
 *      the attachment outright. See spec scenario "Storage is unavailable".
 *
 * Kept separate from the webhook route so it's unit-testable without
 * mocking `next/server` — see `inbound-media.test.ts`.
 */

import { downloadMessageMedia } from "./uazapi";
import { mirrorInboundMedia, type MirrorStorage } from "./mirror-inbound-media";
import { decrypt } from "./encryption";

export type InboundMediaKind = "image" | "video" | "document" | "audio";

/**
 * Normalises the gateway's per-message type field to a bare token.
 *
 * UAZAPI reports inbound types in Baileys proto style — `ImageMessage`,
 * `AudioMessage`, `ExtendedTextMessage`, `LocationMessage`, … — while the
 * old Meta client (and our media vocabulary) used the bare tokens
 * `image`/`audio`/`extendedtext`/`location`. The only systematic
 * difference is the trailing `Message`, so lower-case and strip it; bare
 * tokens and `conversation` pass through untouched. Stripping the suffix
 * is more robust than enumerating every proto constant and cannot
 * regress the bare forms.
 */
export function normalizeMessageType(
  rawType: string | undefined | null,
): string {
  const t = (rawType || "").toLowerCase().trim();
  return t.length > "message".length && t.endsWith("message")
    ? t.slice(0, -"message".length)
    : t;
}

/**
 * Maps a raw `messageType` onto the CRM's media vocabulary. Accepts both
 * the gateway's proto-style spelling (`ImageMessage`, `PttMessage`, …) and
 * the bare tokens (`image`, `ptt`, …) via {@link normalizeMessageType}; a
 * sticker is stored as an image, same as the old Meta client did.
 */
export function mapMediaKind(
  rawType: string | undefined | null,
): InboundMediaKind | null {
  switch (normalizeMessageType(rawType)) {
    case "image":
    case "sticker":
      return "image";
    case "video":
      return "video";
    case "document":
    case "documentwithcaption":
      return "document";
    case "audio":
    case "ptt":
      return "audio";
    default:
      return null;
  }
}

export interface ResolveInboundMediaArgs {
  /** Service-role `supabase.storage` — passed through to `mirrorInboundMedia`. */
  storage: MirrorStorage;
  accountId: string;
  /** UAZAPI `messageid` of the inbound media message. */
  messageId: string;
  /** Encrypted instance token (`whatsapp_config.instance_token`). */
  encryptedInstanceToken: string | null;
  /** `whatsapp_config.mirror_inbound_media` — the per-account opt-out (migration 039). */
  mirrorEnabled: boolean;
  /** `document.filename`, when the sender's client supplied one. */
  fileName?: string | null;
  messageTimestamp?: string | number | null;
}

export interface ResolvedInboundMedia {
  mediaUrl: string | null;
  mediaType: string | null;
}

/**
 * Resolve the file for an inbound media message to a durable URL,
 * mirroring it into `chat-media` unless the account has opted out.
 * Never throws — every failure resolves to `{ mediaUrl: null, mediaType: null }`
 * or a fallback URL, per the two tiers described above.
 */
export async function resolveInboundMedia(
  args: ResolveInboundMediaArgs,
): Promise<ResolvedInboundMedia> {
  const {
    storage,
    accountId,
    messageId,
    encryptedInstanceToken,
    mirrorEnabled,
    fileName,
    messageTimestamp,
  } = args;

  if (!encryptedInstanceToken) {
    console.warn(
      `[inbound-media] no instance token on record; cannot download media for message ${messageId}`,
    );
    return { mediaUrl: null, mediaType: null };
  }

  let fileUrl: string;
  let mimeType: string;
  try {
    const token = decrypt(encryptedInstanceToken);
    const downloaded = await downloadMessageMedia({ token, messageId });
    fileUrl = downloaded.fileUrl;
    mimeType = downloaded.mimeType;
  } catch (error) {
    // Tier 1 — couldn't even resolve a URL from the gateway. Best-effort:
    // logged, not thrown, so the callback still 200s (spec: "Download failure").
    console.error(
      `[inbound-media] failed to resolve media for message ${messageId}:`,
      error instanceof Error ? error.message : error,
    );
    return { mediaUrl: null, mediaType: null };
  }

  if (!mirrorEnabled) {
    return { mediaUrl: fileUrl, mediaType: mimeType };
  }

  const mirrored = await mirrorInboundMedia({
    storage,
    accountId,
    mediaId: messageId,
    downloadUrl: fileUrl,
    mimeType,
    fileName,
    messageTimestamp,
  });

  // Tier 2 — mirrorInboundMedia already logs its own failure cause;
  // fall back to the gateway's URL rather than lose the attachment
  // (spec: "Storage is unavailable").
  return { mediaUrl: mirrored ?? fileUrl, mediaType: mimeType };
}
