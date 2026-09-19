// ============================================================
// GET  /api/admin/operators — the operator register
// POST /api/admin/operators — register an operator
//
// Manager-only (admin-console spec.md, "The console carries the
// register of platform operators" / "Registering an operator creates
// their sign-in identity"). Every action is re-checked on the server —
// src/middleware.ts also gates /admin/operators, but this route has no
// other guard of its own (same reasoning as every other /api/admin/*
// route: middleware does not cover /api/admin).
//
// Writes go through the service-role client: creating a sign-in
// identity and inserting into platform_operators both need it, since
// the table's only RLS policy is "read your own row" (migration 051).
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import {
  isManager,
  resolvePlatformOperator,
  type PlatformOperatorRole,
} from "@/lib/provisioning/platform-admins";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";
import { listOperators } from "@/lib/admin/operators";

/** Mirrors the sign-in system's own minimum (same as the password-reissue route). */
const MIN_PASSWORD = 6;

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isOperatorRole(value: unknown): value is PlatformOperatorRole {
  return value === "manager" || value === "admin";
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();
    const operator = await resolvePlatformOperator(supabase, user);
    if (!isManager(operator)) throw new ForbiddenError();

    const operators = await listOperators(supabaseAdmin());
    return NextResponse.json({ operators });
  } catch (err) {
    return toErrorResponse(err);
  }
}

interface RegisterBody {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  password?: unknown;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();
    const operator = await resolvePlatformOperator(supabase, user);
    if (!isManager(operator)) throw new ForbiddenError();

    const body = (await request.json().catch(() => null)) as RegisterBody | null;
    const fullName = requiredString(body?.name);
    const email = requiredString(body?.email)?.toLowerCase() ?? null;
    const role = body?.role;
    if (!fullName || !email || !isOperatorRole(role)) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 },
      );
    }

    const db = supabaseAdmin();

    // Already an operator (admin-console spec.md, "An address that is
    // already an operator is refused") — checked before touching
    // auth.users so a duplicate never costs an identity lookup.
    const { data: existingOperator } = await db
      .from("platform_operators")
      .select("user_id")
      .eq("email", email)
      .maybeSingle();
    if (existingOperator) {
      return NextResponse.json(
        { error: "This address is already an operator" },
        { status: 409 },
      );
    }

    // A sign-in identity with no operator record is a previously
    // removed operator (design.md D7/D8) — adopt it rather than create
    // a second identity, and leave its password untouched.
    const { data: existingProfile } = await db
      .from("profiles")
      .select("user_id")
      .ilike("email", email)
      .maybeSingle();

    let userId: string;
    let createdIdentity = false;

    if (existingProfile?.user_id) {
      userId = existingProfile.user_id as string;
    } else {
      const password = typeof body?.password === "string" ? body.password : "";
      if (password.length < MIN_PASSWORD) {
        return NextResponse.json(
          { error: `The password must be at least ${MIN_PASSWORD} characters` },
          { status: 400 },
        );
      }

      const { data, error } = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error || !data?.user) {
        return NextResponse.json(
          { error: error?.message ?? "Could not create the sign-in identity" },
          { status: 400 },
        );
      }
      userId = data.user.id as string;
      createdIdentity = true;
    }

    const { error: insertErr } = await db.from("platform_operators").insert({
      user_id: userId,
      email,
      full_name: fullName,
      role,
      created_by: user.id,
    });
    if (insertErr) {
      // A half-registered operator is worse than a failed registration
      // (design.md D7) — but only undo what this request created.
      if (createdIdentity) {
        await db.auth.admin.deleteUser(userId);
      }
      return NextResponse.json(
        { error: "Could not register the operator" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { passwordUnchanged: !createdIdentity },
      { status: 201 },
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
