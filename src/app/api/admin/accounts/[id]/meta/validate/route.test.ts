import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  update: vi.fn(),
  storedToken: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", () => ({
  resolvePlatformOperator: mocks.resolvePlatformOperator,
}));

vi.mock("@/lib/provisioning/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { meta_access_token: mocks.storedToken },
            error: null,
          }),
        }),
      }),
      // Any write at all is a defect — this route validates, it never saves.
      update: (patch: Record<string, unknown>) => {
        mocks.update(table, patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}));

import { POST } from "./route";

function validateRequest(body: unknown) {
  return new Request("http://localhost/api/admin/accounts/acct-1/meta/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "acct-1" });

function graphResponse(body: unknown, status = 200) {
  return vi.fn(
    async (..._args: unknown[]) => new Response(JSON.stringify(body), { status }),
  );
}

beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { email: "ops@effect.com" } } });
  mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
  mocks.update.mockClear();
  mocks.storedToken = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/admin/accounts/[id]/meta/validate", () => {
  it("rejects a non-operator without calling Meta", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(null);
    const fetchMock = graphResponse({});
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(validateRequest({ metaDatasetId: "42" }), { params });

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const fetchMock = graphResponse({});
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(validateRequest({ metaDatasetId: "42" }), { params });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a blank dataset id before any network call", async () => {
    const fetchMock = graphResponse({});
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(validateRequest({ metaDatasetId: "   " }), { params });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the dataset name on success", async () => {
    vi.stubGlobal(
      "fetch",
      graphResponse({
        id: "42",
        name: "Clinic dataset",
        owner_business: { id: "9", name: "Effect" },
      }),
    );

    const res = await POST(
      validateRequest({ metaDatasetId: "42", metaAccessToken: "tok" }),
      { params },
    );

    expect(await res.json()).toEqual({
      ok: true,
      datasetName: "Clinic dataset",
      ownerBusinessName: "Effect",
    });
  });

  it("falls back to the stored token when the field is blank, without returning it", async () => {
    mocks.storedToken = "enc:stored-token";
    const fetchMock = graphResponse({ id: "42", name: "Clinic dataset" });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      validateRequest({ metaDatasetId: "42", metaAccessToken: "  " }),
      { params },
    );

    const headers = fetchMock.mock.calls[0][1] as unknown as {
      headers: Record<string, string>;
    };
    expect(headers.headers.Authorization).toBe("Bearer stored-token");

    const text = await res.text();
    expect(text).not.toContain("stored-token");
    expect(text).not.toContain("enc:");
  });

  it("refuses when no token is supplied and none is stored", async () => {
    const fetchMock = graphResponse({});
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(validateRequest({ metaDatasetId: "42" }), { params });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a dead token", async () => {
    vi.stubGlobal(
      "fetch",
      graphResponse(
        { error: { message: "Session has expired", code: 190 } },
        400,
      ),
    );

    const res = await POST(
      validateRequest({ metaDatasetId: "42", metaAccessToken: "tok" }),
      { params },
    );

    expect(await res.json()).toMatchObject({ ok: false, reason: "invalid_token" });
  });

  it("reports a business manager mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      graphResponse(
        { error: { message: "(#803) Some of the aliases you requested", code: 100 } },
        400,
      ),
    );

    const res = await POST(
      validateRequest({ metaDatasetId: "42", metaAccessToken: "tok" }),
      { params },
    );

    expect(await res.json()).toMatchObject({ ok: false, reason: "business_mismatch" });
  });

  it("passes an unmapped Meta error through verbatim", async () => {
    vi.stubGlobal(
      "fetch",
      graphResponse({ error: { message: "Application request limit reached", code: 4 } }, 400),
    );

    const res = await POST(
      validateRequest({ metaDatasetId: "42", metaAccessToken: "tok" }),
      { params },
    );

    expect(await res.json()).toMatchObject({
      ok: false,
      reason: "meta_error",
      message: "Application request limit reached",
    });
  });

  it("reports a timeout as an unfinished check", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );

    const res = await POST(
      validateRequest({ metaDatasetId: "42", metaAccessToken: "tok" }),
      { params },
    );

    expect(await res.json()).toMatchObject({ ok: false, reason: "unreachable" });
  });

  it("never writes to accounts, on any path", async () => {
    mocks.storedToken = "enc:stored-token";
    vi.stubGlobal("fetch", graphResponse({ id: "42", name: "Clinic dataset" }));

    await POST(validateRequest({ metaDatasetId: "42", metaAccessToken: "tok" }), {
      params,
    });
    await POST(validateRequest({ metaDatasetId: "42" }), { params });

    expect(mocks.update).not.toHaveBeenCalled();
  });
});
