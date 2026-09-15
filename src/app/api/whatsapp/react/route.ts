import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { sendReactionMessage } from "@/lib/whatsapp/uazapi";
import { UazapiError } from "@/lib/whatsapp/uazapi-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

/**
 * POST /api/whatsapp/react
 *
 * Body: { message_id: <internal UUID>, emoji: <single emoji or "" to remove> }
 *
 * Sends the reaction via UAZAPI and mirrors it into `message_reactions`
 * (delete on empty emoji). Customer-side reactions are handled by the
 * webhook — this route only writes `actor_type = 'agent'` rows.
 */
export async function POST(request: Request) {
  try {
    // Reacting is a write operation (`canSendMessages`), and it pushes the
    // reaction to Meta before mirroring it locally — so, as on /send, a
    // missing role check let a read-only viewer put a visible reaction on
    // the customer's message even though RLS blocked the local mirror.
    const { supabase, accountId, userId } = await requireRole("agent");

    const limit = checkRateLimit(`react:${userId}`, RATE_LIMITS.react);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const { message_id, emoji } = body as {
      message_id?: string;
      emoji?: string;
    };

    if (!message_id || typeof emoji !== "string") {
      return NextResponse.json(
        { error: "message_id and emoji are required" },
        { status: 400 },
      );
    }

    // Resolve target message + its conversation; verify ownership.
    const { data: targetMessage, error: msgError } = await supabase
      .from("messages")
      .select("id, message_id, conversation_id")
      .eq("id", message_id)
      .maybeSingle();

    if (msgError || !targetMessage) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    if (!targetMessage.message_id) {
      // No Meta ID yet — usually a sending/failed agent message. We can't
      // tell Meta to react to a message it never received.
      return NextResponse.json(
        {
          error: "Cannot react to a message that has not been sent to WhatsApp",
        },
        { status: 400 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, account_id, contact:contacts(phone)")
      .eq("id", targetMessage.conversation_id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }

    const contact = Array.isArray(conversation.contact)
      ? conversation.contact[0]
      : conversation.contact;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: "Contact phone number not found" },
        { status: 400 },
      );
    }

    // WhatsApp config + instance token. Account-scoped post-multi-user.
    const { data: config, error: configError } = await supabase
      .from("whatsapp_config")
      .select("instance_token, connection_state")
      .eq("account_id", accountId)
      .single();

    if (configError || !config || !config.instance_token) {
      return NextResponse.json(
        { error: "WhatsApp not configured." },
        { status: 400 },
      );
    }

    if (config.connection_state !== "connected") {
      return NextResponse.json(
        {
          error:
            "WhatsApp is not connected. Reconnect from Settings → WhatsApp before reacting to messages.",
        },
        { status: 400 },
      );
    }

    const token = decrypt(config.instance_token);
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);

    try {
      await sendReactionMessage({
        token,
        to: sanitizedPhone,
        targetMessageId: targetMessage.message_id,
        emoji,
      });
    } catch (err) {
      // Mirrors `/api/whatsapp/config`'s `errorResponse` — `unauthenticated`
      // means OUR stored instance token is stale, not that the caller is,
      // hence 502 rather than 401.
      const status =
        err instanceof UazapiError
          ? err.code === "rate_limited"
            ? 429
            : err.code === "invalid_request"
              ? 400
              : 502
          : 502;
      const message =
        err instanceof Error ? err.message : "Unknown WhatsApp gateway error";
      console.error("[whatsapp/react] WhatsApp send failed:", message);
      return NextResponse.json(
        { error: `WhatsApp gateway error: ${message}` },
        { status },
      );
    }

    // Mirror into DB. Empty emoji = removal.
    if (emoji === "") {
      const { error: delError } = await supabase
        .from("message_reactions")
        .delete()
        .eq("message_id", targetMessage.id)
        .eq("actor_type", "agent")
        .eq("actor_id", userId);

      if (delError) {
        console.error("[whatsapp/react] DB delete failed:", delError.message);
        return NextResponse.json(
          { error: "Reaction sent to Meta but DB delete failed" },
          { status: 500 },
        );
      }
    } else {
      // Upsert. The unique constraint (message_id, actor_type, actor_id)
      // lets us swap emoji in a single statement.
      const { error: upsertError } = await supabase
        .from("message_reactions")
        .upsert(
          {
            message_id: targetMessage.id,
            conversation_id: targetMessage.conversation_id,
            actor_type: "agent",
            actor_id: userId,
            emoji,
          },
          { onConflict: "message_id,actor_type,actor_id" },
        );

      if (upsertError) {
        console.error(
          "[whatsapp/react] DB upsert failed:",
          upsertError.message,
        );
        return NextResponse.json(
          { error: "Reaction sent to Meta but DB upsert failed" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // requireRole throws Unauthorized/Forbidden; toErrorResponse maps
    // those to 401/403 and collapses anything else to a generic 500.
    console.error("Error in WhatsApp react POST:", error);
    return toErrorResponse(error);
  }
}
