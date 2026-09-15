import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  provisionInstance,
  startLogin,
  readInstanceStatus,
  disconnectInstance,
  InstanceError,
} from "@/lib/whatsapp/instance";
import { UazapiError } from "@/lib/whatsapp/uazapi-client";
import { resolveRequestOrigin } from "@/lib/http/request-origin";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * `/api/whatsapp/config` — the UAZAPI connect wizard's backend.
 *
 *   GET  — redacted snapshot of the account's WhatsApp configuration.
 *          Any member (viewer+) may read; never returns instance_token
 *          or webhook_secret (whatsapp-connection spec, "Configuration
 *          read redacts secrets").
 *   POST — { action: 'provision' | 'start_login' | 'status' |
 *            'disconnect', phone? }.
 *          Owner/admin only (`requireRole('admin')`) — provisioning,
 *          (re)connecting, and disconnecting all mutate the shared
 *          account-wide instance.
 *
 * Replaces the Meta-era phone-number-ID / WABA-ID / access-token form
 * — see design.md D1/D2.
 */

const SELECT_COLUMNS =
  "instance_id, connection_state, paired_phone, paired_at, mirror_inbound_media";

function configResponse(
  row: {
    instance_id: string | null;
    connection_state: string;
    paired_phone: string | null;
    paired_at: string | null;
    mirror_inbound_media: boolean | null;
  } | null,
) {
  return {
    configured: Boolean(row?.instance_id),
    connection_state: row?.connection_state ?? "disconnected",
    paired_phone: row?.paired_phone ?? null,
    paired_at: row?.paired_at ?? null,
    mirror_inbound_media: row?.mirror_inbound_media !== false,
  };
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await ctx.supabase
      .from("whatsapp_config")
      .select(SELECT_COLUMNS)
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/whatsapp/config] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load configuration" },
        { status: 500 },
      );
    }

    return NextResponse.json(configResponse(data));
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Maps the transport/instance error families onto HTTP status + message. */
function errorResponse(err: unknown): NextResponse {
  if (err instanceof InstanceError) {
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status },
    );
  }
  if (err instanceof UazapiError) {
    // unauthenticated here means OUR instance token is stale, not that
    // the caller is unauthenticated — 502 (a bad upstream credential)
    // rather than 401 (which would suggest the caller's own session).
    const status =
      err.code === "rate_limited"
        ? 429
        : err.code === "invalid_request"
          ? 400
          : 502;
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status },
    );
  }
  console.error("[whatsapp/config] unexpected error:", err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("admin");

    const limit = checkRateLimit(
      `whatsapp-connection:${userId}`,
      RATE_LIMITS.whatsappConnection,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => ({}));
    const action = (body as { action?: unknown }).action;
    const phone = (body as { phone?: unknown }).phone;

    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.trim()?.replace(/\/+$/, "") ||
      resolveRequestOrigin(request);
    const originOrThrow = (): string => {
      if (!origin) {
        throw new InstanceError(
          "gateway_error",
          "Could not determine this server's public URL to register the WhatsApp webhook. Set NEXT_PUBLIC_SITE_URL.",
          500,
        );
      }
      return origin;
    };

    switch (action) {
      case "provision": {
        const result = await provisionInstance({
          db: supabase,
          accountId,
          userId,
        });
        return NextResponse.json(result);
      }
      case "start_login": {
        // "Starting the connection flow" provisions on first use — see
        // whatsapp-connection spec, "First connection provisions an
        // instance" — so the wizard doesn't need a separate step.
        await provisionInstance({ db: supabase, accountId, userId });
        const result = await startLogin({
          db: supabase,
          accountId,
          origin: originOrThrow(),
          phone: typeof phone === "string" ? phone : null,
        });
        return NextResponse.json(result);
      }
      case "status": {
        const result = await readInstanceStatus(supabase, accountId);
        return NextResponse.json(result);
      }
      case "disconnect": {
        await disconnectInstance(supabase, accountId);
        return NextResponse.json({ success: true });
      }
      default:
        return NextResponse.json(
          {
            error:
              "'action' must be one of provision, start_login, status, disconnect",
          },
          { status: 400 },
        );
    }
  } catch (err) {
    if (err instanceof InstanceError || err instanceof UazapiError) {
      return errorResponse(err);
    }
    return toErrorResponse(err);
  }
}
