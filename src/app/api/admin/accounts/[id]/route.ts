// ============================================================
// PATCH /api/admin/accounts/[id]
//
// The account row itself: its name, and whether it is in service
// (admin-console spec.md, "An operator can correct an account's name"
// and "An account can be taken out of service without losing
// anything"). One route because both write one row and share the same
// allow-list re-check (design.md D5). A password goes through
// ./password instead — nothing that writes an account handles one.
//
// Gated by PLATFORM_ADMINS and re-checked here: src/middleware.ts
// guards paths starting with /admin, which does NOT cover /api/admin.
//
// Writes go through the service-role client, like every other admin
// route: the accounts policies are membership-based and an operator is
// not a member of the client's account.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { isPlatformAdmin } from "@/lib/provisioning/platform-admins";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";

interface AccountPatchBody {
  name?: unknown;
  deactivated?: unknown;
}

/** The conversion states that have not been delivered yet. */
const UNDELIVERED = ["pending", "unconfigured"] as const;

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
    if (!isPlatformAdmin(user.email)) throw new ForbiddenError();

    const body = (await request.json().catch(() => null)) as AccountPatchBody | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    // Provisioning guarantees every account has a name; renaming must
    // not be able to undo that (admin-console spec.md, "Empty name is
    // refused"). Rejected before any write, so the account keeps the
    // name it had.
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return NextResponse.json(
          { error: "An account must have a name" },
          { status: 400 },
        );
      }
      patch.name = name;
    }

    const deactivating = body.deactivated === true;
    if (typeof body.deactivated === "boolean") {
      patch.deactivated_at = deactivating ? new Date().toISOString() : null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const db = supabaseAdmin();

    const { error } = await db.from("accounts").update(patch).eq("id", accountId);
    if (error) {
      console.error("[admin/accounts] update failed:", error.message);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }

    // A Click is only an attribution key to Meta for seven days, so a
    // conversion waiting on a deactivated account would be rejected by
    // the time the account comes back (design.md D4). Cancelling is the
    // state migration 049 already defines for a conversion nobody will
    // deliver. Reactivation does not revive them, so this runs on the
    // deactivate branch only.
    let canceledConversions = 0;
    if (deactivating) {
      const { data, error: cancelErr } = await db
        .from("meta_capi_events")
        .update({ status: "canceled" })
        .eq("account_id", accountId)
        .in("status", UNDELIVERED)
        .select("id");
      if (cancelErr) {
        // The account is already out of service — the cut that matters
        // landed. Report the account as deactivated and say the cancel
        // did not, rather than claiming a clean failure.
        console.error(
          "[admin/accounts] deactivated, but cancelling conversions failed:",
          cancelErr.message,
        );
        return NextResponse.json(
          {
            ok: true,
            deactivated: true,
            canceledConversions: null,
            warning: "Conversions waiting to be delivered could not be cancelled",
          },
          { status: 200 },
        );
      }
      canceledConversions = data?.length ?? 0;
    }

    return NextResponse.json({ ok: true, canceledConversions });
  } catch (err) {
    return toErrorResponse(err);
  }
}
