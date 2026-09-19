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
import {
  FUNNEL_MODEL_KEYS,
  SPECIALTY_KEYS,
  type FunnelModelKey,
  type SpecialtyKey,
} from "@/lib/provisioning/templates";
import { provision, ProvisionError } from "@/lib/provisioning/provision";

interface ProvisionRequestBody {
  clinicName?: unknown;
  clientFullName?: unknown;
  clientEmail?: unknown;
  clientPassword?: unknown;
  specialty?: unknown;
  specialtyOther?: unknown;
  funnelModel?: unknown;
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

    // The clinic name, the full name and the advertising fields resolve
    // to a default inside provision() (design.md D6), so the route
    // doesn't reject them when absent. The specialty and the funnel
    // model are required (provisioning spec.md, "Missing specialty or
    // funnel model is refused") and have no default.
    const clinicName = requiredString(body?.clinicName) ?? undefined;
    const clientFullName = requiredString(body?.clientFullName) ?? undefined;
    const clientEmail = requiredString(body?.clientEmail);
    const clientPassword =
      typeof body?.clientPassword === "string" ? body.clientPassword : null;
    const specialty = requiredString(body?.specialty);
    const specialtyOther = requiredString(body?.specialtyOther) ?? undefined;
    const funnelModel = requiredString(body?.funnelModel);
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

    // Specialty and funnel model are both required and independent —
    // neither is defaulted, and no combination of the two is refused
    // (provisioning spec.md, "One submission provisions a complete
    // account"). "Outros" additionally requires its free text
    // ("'Outros' requires its text").
    if (!specialty || !SPECIALTY_KEYS.includes(specialty as SpecialtyKey)) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 },
      );
    }
    if (specialty === "other" && !specialtyOther) {
      return NextResponse.json(
        { error: "Missing or invalid fields" },
        { status: 400 },
      );
    }
    if (!funnelModel || !FUNNEL_MODEL_KEYS.includes(funnelModel as FunnelModelKey)) {
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
      specialty: specialty as SpecialtyKey,
      specialtyOther,
      funnelModel: funnelModel as FunnelModelKey,
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
