import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isPlatformAdmin: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
}));

vi.mock("@/lib/provisioning/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        mocks.update(table, patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
}));

import { PATCH } from "./route";

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/admin/accounts/acct-1/meta", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function call(body: unknown) {
  return PATCH(patchRequest(body), {
    params: Promise.resolve({ id: "acct-1" }),
  });
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.isPlatformAdmin.mockReset();
  mocks.update.mockReset();
  mocks.getUser.mockResolvedValue({
    data: { user: { email: "ops@effect.dev" } },
  });
  mocks.isPlatformAdmin.mockReturnValue(true);
});

describe("PATCH /api/admin/accounts/[id]/meta", () => {
  it("rejects an unauthenticated request and writes nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await call({ metaDatasetId: "ds-1" });
    expect(res.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects a non-operator session and writes nothing", async () => {
    mocks.isPlatformAdmin.mockReturnValue(false);
    const res = await call({ metaDatasetId: "ds-1" });
    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("updates the plain-text fields present in the body", async () => {
    const res = await call({
      metaDatasetId: "ds-1",
      metaPageId: "page-1",
      metaTestEventCode: "TEST123",
    });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("accounts", {
      meta_dataset_id: "ds-1",
      meta_page_id: "page-1",
      meta_test_event_code: "TEST123",
    });
  });

  it("clears a plain-text field when it is submitted empty", async () => {
    await call({ metaTestEventCode: "" });
    expect(mocks.update).toHaveBeenCalledWith("accounts", {
      meta_test_event_code: null,
    });
  });

  it("leaves the access token unchanged when the field is blank", async () => {
    await call({ metaAccessToken: "", metaPageId: "page-1" });
    expect(mocks.update).toHaveBeenCalledWith("accounts", {
      meta_page_id: "page-1",
    });
  });

  it("stores a submitted access token encrypted", async () => {
    await call({ metaAccessToken: "real-token" });
    expect(mocks.update).toHaveBeenCalledWith("accounts", {
      meta_access_token: "enc:real-token",
    });
  });

  it("rejects an invalid event name and writes nothing", async () => {
    const res = await call({ metaEventName: "not a token!", metaPageId: "page-1" });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects an empty event name and writes nothing", async () => {
    const res = await call({ metaEventName: "" });
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("accepts a valid event name", async () => {
    const res = await call({ metaEventName: "Purchase" });
    expect(res.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith("accounts", {
      meta_event_name: "Purchase",
    });
  });

  it("updates the consent flag", async () => {
    await call({ metaSendPh: true });
    expect(mocks.update).toHaveBeenCalledWith("accounts", { meta_send_ph: true });
  });

  it("rejects an empty body with nothing to update", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
