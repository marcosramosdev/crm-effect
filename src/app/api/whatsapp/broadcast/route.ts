import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  sendTextMessage,
  sendMediaMessage,
  fetchMediaAsBase64,
  type MediaKind,
} from "@/lib/whatsapp/uazapi";
import { decrypt } from "@/lib/whatsapp/encryption";
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from "@/lib/whatsapp/phone-utils";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

interface BroadcastResult {
  phone: string;
  status: "sent" | "failed";
  whatsapp_message_id?: string;
  error?: string;
}

/**
 * Per-recipient send used by the dashboard wizard's batch loop
 * (`use-broadcast-sending.ts`). Unlike the old Meta-template version,
 * there is no server-side variable substitution here — the caller
 * (which already has each contact's data) resolves `{{field}}`
 * placeholders client-side via `broadcast-variables.ts` and sends the
 * FINAL text per recipient. This route's only job is the free-form
 * send + phone-variant retry, same as `send-message.ts`, fanned out
 * over a batch. See design.md D1/D5.
 */
interface BroadcastRecipient {
  phone: string;
  /** Fully-resolved body/caption text for this recipient. */
  text: string;
}

export async function POST(request: Request) {
  try {
    // Requires the 'agent' role — `canSendMessages` in lib/auth/roles is
    // explicit that running broadcasts is a write operation and that
    // viewers are read-only.
    const { supabase, accountId, userId } = await requireRole("agent");

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${userId}`, RATE_LIMITS.broadcast);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { recipients, media_url, media_kind, media_filename } = body as {
      recipients?: unknown;
      media_url?: string;
      media_kind?: MediaKind;
      media_filename?: string;
    };

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: "`recipients` must be a non-empty array of { phone, text }" },
        { status: 400 },
      );
    }

    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("instance_token, connection_state")
      .eq("account_id", accountId)
      .single();

    if (configError || !config || !config.instance_token) {
      return NextResponse.json(
        {
          error:
            "WhatsApp not configured. Please set up your WhatsApp integration first.",
        },
        { status: 400 },
      );
    }
    if (config.connection_state !== "connected") {
      return NextResponse.json(
        {
          error:
            "WhatsApp is not connected. Reconnect from Settings → WhatsApp before sending messages.",
        },
        { status: 400 },
      );
    }

    const token = decrypt(config.instance_token);

    // Media is shared across the whole batch — read + base64-encode it
    // ONCE rather than once per recipient (design.md D4).
    let media: { fileBase64: string; mimetype: string } | undefined;
    if (media_url && media_kind) {
      try {
        media = await fetchMediaAsBase64(media_url);
      } catch (err) {
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "Could not read the broadcast attachment",
          },
          { status: 502 },
        );
      }
    }

    const results: BroadcastResult[] = [];
    let sentCount = 0;
    let failedCount = 0;

    for (const recipient of recipients as BroadcastRecipient[]) {
      const sanitized = sanitizePhoneForMeta(recipient.phone);

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: "failed",
          error: "Invalid phone number format",
        });
        failedCount++;
        continue;
      }

      const variants = phoneVariants(sanitized);
      let sentMessageId: string | null = null;
      let lastError: string | null = null;

      for (const variant of variants) {
        try {
          const result = media
            ? await sendMediaMessage({
                token,
                to: variant,
                kind: media_kind!,
                fileBase64: media.fileBase64,
                mimetype: media.mimetype,
                caption: recipient.text || undefined,
                filename: media_filename || undefined,
              })
            : await sendTextMessage({
                token,
                to: variant,
                text: recipient.text,
              });
          sentMessageId = result.messageId;
          lastError = null;
          break;
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          lastError = errorMessage;
          if (!isRecipientNotAllowedError(errorMessage)) break;
          // retry with next variant
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: "sent",
          whatsapp_message_id: sentMessageId,
        });
        sentCount++;
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError,
        );
        results.push({
          phone: recipient.phone,
          status: "failed",
          error: lastError || "Unknown error",
        });
        failedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    });
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error("Error in WhatsApp broadcast POST:", error);
    return toErrorResponse(error);
  }
}
