import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { SendMessageError } from "@/lib/whatsapp/send-message";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";

// Resolve-only companion to `/api/whatsapp/send`: find-or-create the
// contact + conversation for a target WITHOUT sending anything. Backs
// the start-a-conversation dialog's "open the thread without sending"
// path (inbox spec, "Start a new conversation from the app"). Because
// nothing is sent there is no rollback — an empty thread is the
// intended outcome.
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");

    // Shares the dashboard send budget — opening a thread is cheap but
    // still a write, and this keeps a loop from spraying empty threads.
    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = await request.json();
    const contactId =
      typeof body.contact_id === "string" && body.contact_id.trim() !== ""
        ? body.contact_id.trim()
        : null;
    const to =
      typeof body.to === "string" && body.to.trim() !== ""
        ? body.to.trim()
        : null;
    const name = typeof body.name === "string" ? body.name : null;

    if ((contactId && to) || (!contactId && !to)) {
      return NextResponse.json(
        { error: "Exactly one of contact_id or to is required" },
        { status: 400 },
      );
    }

    // ---- contact_id path -----------------------------------------
    if (contactId) {
      const { data: contactRow, error: contactErr } = await supabase
        .from("contacts")
        .select("id")
        .eq("id", contactId)
        .eq("account_id", accountId)
        .maybeSingle();
      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: "Contact not found" },
          { status: 404 },
        );
      }

      const { data: existing } = await supabase
        .from("conversations")
        .select("id")
        .eq("account_id", accountId)
        .eq("contact_id", contactId)
        .order("created_at", { ascending: true })
        .limit(1);

      if (existing && existing.length > 0) {
        return NextResponse.json({
          conversation_id: existing[0].id,
          contact_id: contactId,
          contact_created: false,
        });
      }

      const { data: created, error } = await supabase
        .from("conversations")
        .insert({
          account_id: accountId,
          user_id: userId,
          contact_id: contactId,
        })
        .select("id")
        .single();
      if (error || !created) {
        return NextResponse.json(
          { error: "Failed to open a conversation for this contact" },
          { status: 500 },
        );
      }
      return NextResponse.json({
        conversation_id: created.id,
        contact_id: contactId,
        contact_created: false,
      });
    }

    // ---- to (phone) path ---------------------------------------
    try {
      const resolved = await resolveConversationByPhone(
        supabase,
        accountId,
        to as string,
        name,
      );
      return NextResponse.json({
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
      });
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      throw err;
    }
  } catch (error) {
    console.error("Error in WhatsApp conversations POST:", error);
    return toErrorResponse(error);
  }
}
