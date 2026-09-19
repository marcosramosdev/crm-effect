// ============================================================
// DELETE /api/admin/operators/[id]
//
// `id` is the operator's `user_id`. Removal deletes the operator
// record only — the sign-in identity, its profile and whatever
// account it owns all survive (admin-console spec.md, "Removing an
// operator withdraws the console, not the sign-in identity";
// design.md D8). Manager-only, re-checked here for the same reason
// every other /api/admin/* route re-checks: middleware does not cover
// /api/admin.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import {
  isManager,
  isSeededOperatorEmail,
  resolvePlatformOperator,
} from "@/lib/provisioning/platform-admins";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: userId } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();
    const operator = await resolvePlatformOperator(supabase, user);
    if (!isManager(operator)) throw new ForbiddenError();

    // "No operator can remove or promote themselves" — refused before
    // the record is even read.
    if (userId === user.id) {
      return NextResponse.json(
        { error: "You cannot remove your own access" },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    const { data: row } = await db
      .from("platform_operators")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle();
    if (!row) {
      return NextResponse.json({ error: "Operator not found" }, { status: 404 });
    }

    // The seed resolves to manager regardless of this table (design.md
    // D3), so deleting a seeded row would come back at the next
    // request — the register says so rather than offering a control
    // that silently fails.
    if (isSeededOperatorEmail(row.email as string)) {
      return NextResponse.json(
        {
          error:
            "This operator is seeded by the deployment configuration and cannot be removed",
        },
        { status: 400 },
      );
    }

    const { error } = await db
      .from("platform_operators")
      .delete()
      .eq("user_id", userId);
    if (error) {
      return NextResponse.json({ error: "Removal failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
