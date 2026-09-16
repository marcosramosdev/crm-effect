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
import { isPlatformAdmin } from "@/lib/provisioning/platform-admins";
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
    if (!isPlatformAdmin(user.email)) throw new ForbiddenError();

    const body = (await request.json().catch(() => null)) as ProvisionRequestBody | null;

    const clinicName = requiredString(body?.clinicName);
    const clientFullName = requiredString(body?.clientFullName);
    const clientEmail = requiredString(body?.clientEmail);
    const clientPassword =
      typeof body?.clientPassword === "string" ? body.clientPassword : null;
    const specialty = requiredString(body?.specialty);
    const persona = typeof body?.persona === "string" ? body.persona.trim() : "";
    const metaDatasetId = requiredString(body?.metaDatasetId);
    const metaAccessToken =
      typeof body?.metaAccessToken === "string" ? body.metaAccessToken.trim() : null;

    if (
      !clinicName ||
      !clientFullName ||
      !clientEmail ||
      !clientPassword ||
      !specialty ||
      !metaDatasetId ||
      !metaAccessToken ||
      !SPECIALTY_KEYS.includes(specialty as SpecialtyKey)
    ) {
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
      specialty: specialty as SpecialtyKey,
      persona,
      metaDatasetId,
      metaAccessToken,
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
