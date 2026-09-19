// ============================================================
// POST /api/admin/accounts/[id]/password
//
// Reissues the password of an account's owner, because the operator
// chose and delivered it in the first place (admin-console spec.md,
// "An operator can reissue the client's password").
//
// Kept apart from PATCH /api/admin/accounts/[id] on purpose
// (design.md D5): this is the only admin route that writes to
// auth.users, and no route that writes an account row handles a
// password. The value is never echoed back and never logged — the
// operator's own browser holds what they typed, exactly as the
// provisioning form does.
//
// Gated by PLATFORM_ADMINS and re-checked here: src/middleware.ts
// guards /admin, not /api/admin.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { resolvePlatformOperator } from "@/lib/provisioning/platform-admins";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";

/** Supabase is the real authority and refuses a short password itself;
 *  this guard is what turns that into a message an operator can read,
 *  before anything is written. */
const MIN_PASSWORD = 6;

interface PasswordBody {
  password?: unknown;
}

export async function POST(
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

    const body = (await request.json().catch(() => null)) as PasswordBody | null;
    const password = typeof body?.password === "string" ? body.password : "";
    if (password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `The password must be at least ${MIN_PASSWORD} characters` },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    const { data: account, error: accountErr } = await db
      .from("accounts")
      .select("owner_user_id")
      .eq("id", accountId)
      .maybeSingle();
    if (accountErr || !account?.owner_user_id) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Setting a password through the admin API revokes the user's
    // refresh tokens, so the session that was open on the old password
    // dies at its next refresh (design.md D5).
    const { error } = await db.auth.admin.updateUserById(
      account.owner_user_id as string,
      { password },
    );
    if (error) {
      // Supabase's own wording ("Password should be at least ...") is
      // the useful part; the password itself is never in it.
      console.error("[admin/accounts/password] reissue failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Deliberately no password in the response — the operator's form
    // already holds it (admin-console spec.md).
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
