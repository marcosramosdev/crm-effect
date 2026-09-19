// ============================================================
// POST /api/admin/accounts/[id]/meta/validate
//
// Checks a dataset identifier and an access token against Meta and
// answers at once whether that token can see that dataset
// (admin-console spec.md, "Advertising credentials can be checked
// against Meta before they are saved").
//
// It checks what is in the form, not what is stored: the failure this
// exists to catch is a typo, and validating only after saving means
// storing the typo first (design.md D4).
//
// POST rather than GET because the token travels in the body. A GET
// would put a live credential in a URL, and from there into every
// access log between here and Meta.
//
// Gated by PLATFORM_ADMINS and re-checked here — src/middleware.ts
// guards paths starting with /admin, which does NOT cover /api/admin
// (same reasoning as the sibling PATCH route).
//
// Writes nothing, ever. A token generated in Meta's Events Manager
// dies with the access of whoever generated it, so a recorded past
// success would say nothing about the present (design.md D6).
// ============================================================

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { UnauthorizedError, ForbiddenError, toErrorResponse } from "@/lib/auth/account";
import { resolvePlatformOperator } from "@/lib/provisioning/platform-admins";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { metaGraphGet } from "@/lib/meta/graph";

interface ValidateBody {
  metaDatasetId?: unknown;
  metaAccessToken?: unknown;
}

interface DatasetFields {
  id?: string;
  name?: string;
  owner_business?: { id?: string; name?: string };
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

    const body = (await request.json().catch(() => null)) as ValidateBody | null;
    const datasetId =
      typeof body?.metaDatasetId === "string" ? body.metaDatasetId.trim() : "";
    if (!datasetId) {
      return NextResponse.json(
        { error: "A dataset id is required to validate" },
        { status: 400 },
      );
    }

    // Blank token means "use the stored one", matching the PATCH
    // route's rule that a blank token leaves the credential alone. The
    // two surfaces must not disagree about what blank means.
    const submitted =
      typeof body?.metaAccessToken === "string" ? body.metaAccessToken.trim() : "";

    let token = submitted;
    if (!token) {
      const { data: account } = await supabaseAdmin()
        .from("accounts")
        .select("meta_access_token")
        .eq("id", accountId)
        .maybeSingle();

      const stored = account?.meta_access_token as string | null | undefined;
      if (!stored) {
        return NextResponse.json(
          { error: "No access token was supplied and none is stored" },
          { status: 400 },
        );
      }
      try {
        token = decrypt(stored);
      } catch {
        // A ciphertext this deployment's key cannot open is a
        // configuration fault on our side, not a Meta rejection.
        return NextResponse.json(
          { error: "The stored access token could not be read" },
          { status: 500 },
        );
      }
    }

    const result = await metaGraphGet<DatasetFields>({
      path: datasetId,
      params: { fields: "id,name,owner_business" },
      token,
    });

    // The token never travels back to the browser on any path — only
    // the dataset's own identity does.
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason, message: result.message },
        { status: 200 },
      );
    }

    return NextResponse.json({
      ok: true,
      datasetName: result.data.name ?? null,
      ownerBusinessName: result.data.owner_business?.name ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
