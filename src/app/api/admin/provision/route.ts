// ============================================================
// POST /api/admin/provision
//
// Backs the /admin console's provisioning form. Gated by
// PLATFORM_ADMINS, re-checked here even though the middleware
// already gated the page — client-provisioning spec, "Server
// re-checks on submit": "regardless of what the browser sent".
//
// The response never echoes the client's password back — the
// operator's own form already holds it locally. Only the delivered
// e-mail is returned on success.
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { resolvePlatformOperator } from "@/lib/provisioning/platform-admins";
import { validateMetaEventName } from "@/lib/meta/event-name";
import { SPECIALTY_KEYS, type SpecialtyKey } from "@/lib/provisioning/templates";
import { provision, ProvisionError } from "@/lib/provisioning/provision";

interface ProvisionRequestBody {
  clinicName?: unknown;
  clientFullName?: unknown;
  clientEmail?: unknown;
  clientPassword?: unknown;
  specialty?: unknown;
  persona?: unknown;
  metaDatasetId?: unknown;
  metaAccessToken?: unknown;
  metaPageId?: unknown;
  metaEventName?: unknown;
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();
    const operator = await resolvePlatformOperator(supabase, user);
    if (!operator) throw new ForbiddenError();

    const body = (await request.json().catch(() => null)) as ProvisionRequestBody | null;

    // Only the address and the password are required (provisioning
    // spec.md, "Address and password alone provision an account").
    // Everything else resolves to a default inside provision()
    // (design.md D6), so the route stops rejecting the absent ones.
    const clinicName = requiredString(body?.clinicName) ?? undefined;
    const clientFullName = requiredString(body?.clientFullName) ?? undefined;
    const clientEmail = requiredString(body?.clientEmail);
    const clientPassword =
      typeof body?.clientPassword === "string" ? body.clientPassword : null;
    const specialty = requiredString(body?.specialty);
    const persona = typeof body?.persona === "string" ? body.persona.trim() : "";
    // Optional at provisioning time (provisioning spec.md, "Provisioning
    // without advertising configuration") — an operator fills these in
    // later via /api/admin/accounts/[id]/meta.
    const metaDatasetId = requiredString(body?.metaDatasetId) ?? undefined;
    const metaAccessToken =
      typeof body?.metaAccessToken === "string" && body.metaAccessToken.trim()
        ? body.metaAccessToken.trim()
        : undefined;
    const metaPageId = requiredString(body?.metaPageId) ?? undefined;

    // The event name is validated through the same module the edit
    // surface uses, so the two surfaces reject exactly the same values
    // (admin-console spec.md, "Same event name is rejected in both
    // places"). Checked before provision() runs: a rejected name must
    // leave no auth user and no account behind.
    let metaEventName: string | undefined;
    if (
      typeof body?.metaEventName === "string" &&
      body.metaEventName.trim() !== ""
    ) {
      const checked = validateMetaEventName(body.metaEventName);
      if (checked.error) {
        return NextResponse.json({ error: checked.error }, { status: 400 });
      }
      metaEventName = checked.value;
    }

    // A supplied specialty must still be one we have a template for; an
    // absent one falls back to DEFAULT_SPECIALTY in provision().
    if (specialty && !SPECIALTY_KEYS.includes(specialty as SpecialtyKey)) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 },
      );
    }

    if (!clientEmail || !clientPassword) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 },
      );
    }

    const result = await provision({
      clinicName,
      clientFullName,
      clientEmail,
      clientPassword,
      specialty: (specialty as SpecialtyKey | null) ?? undefined,
      persona,
      metaDatasetId,
      metaAccessToken,
      metaPageId,
      metaEventName,
    });

    return NextResponse.json({ email: result.email }, { status: 201 });
  } catch (err) {
    if (err instanceof ProvisionError) {
      return NextResponse.json(
        { error: err.message, step: err.step, survivors: err.survivors ?? null },
        { status: 500 },
      );
    }
    return toErrorResponse(err);
  }
}
