// ============================================================
// PATCH /api/admin/accounts/[id]/meta
//
// Lets a platform operator edit an account's Meta advertising
// configuration after provisioning (provisioning spec.md, "Operators
// can change the advertising configuration after provisioning";
// design.md D7). Gated by PLATFORM_ADMINS and re-checked here —
// src/middleware.ts guards paths starting with /admin, which does
// NOT cover /api/admin (same reasoning as /api/admin/provision).
//
// Writes go through the service-role client, not the operator's own
// session: the accounts policies are membership-based and an
// operator is not a member of the client's account, so a
// session-scoped update would silently match zero rows (design.md
// D7).
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { resolvePlatformOperator } from "@/lib/provisioning/platform-admins";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";
import { encrypt } from "@/lib/whatsapp/encryption";
import { validateMetaEventName } from "@/lib/meta/event-name";

interface MetaPatchBody {
  metaDatasetId?: unknown;
  metaAccessToken?: unknown;
  metaPageId?: unknown;
  metaEventName?: unknown;
  metaTestEventCode?: unknown;
  metaSendPh?: unknown;
}

/**
 * A plain-text config field: absent from the body leaves the column
 * untouched (undefined); an empty string clears it (null); anything
 * else sets it. Distinct from the access token below, which treats
 * blank as "leave unchanged" instead — see tasks.md 5.4.
 */
function clearableString(value: unknown): string | null | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: accountId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();
    const operator = await resolvePlatformOperator(supabase, user);
    if (!operator) throw new ForbiddenError();

    const body = (await request.json().catch(() => null)) as MetaPatchBody | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    const datasetId = clearableString(body.metaDatasetId);
    if (datasetId !== undefined) patch.meta_dataset_id = datasetId;

    const pageId = clearableString(body.metaPageId);
    if (pageId !== undefined) patch.meta_page_id = pageId;

    const testEventCode = clearableString(body.metaTestEventCode);
    if (testEventCode !== undefined) patch.meta_test_event_code = testEventCode;

    // A blank token means "leave unchanged" — re-saving the form with
    // the token field left blank must never overwrite the stored
    // credential with encrypt("") (tasks.md 5.4).
    if (typeof body.metaAccessToken === "string" && body.metaAccessToken.trim()) {
      patch.meta_access_token = encrypt(body.metaAccessToken.trim());
    }

    // Validated before any write: a rejected event name must leave the
    // account completely untouched, not partially updated with the
    // other fields in the same request (tasks.md 5.5).
    if (body.metaEventName !== undefined) {
      const eventName = validateMetaEventName(body.metaEventName);
      if (eventName.error) {
        return NextResponse.json({ error: eventName.error }, { status: 400 });
      }
      patch.meta_event_name = eventName.value;
    }

    if (typeof body.metaSendPh === "boolean") {
      patch.meta_send_ph = body.metaSendPh;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const { error } = await supabaseAdmin()
      .from("accounts")
      .update(patch)
      .eq("id", accountId);
    if (error) {
      console.error("[admin/accounts/meta] update failed:", error.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
