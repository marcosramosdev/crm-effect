import { beforeEach, describe, expect, it, vi } from "vitest";

// tasks.md 5.5/5.6 — reissuing the owner's password. The value never
// comes back in the response and never reaches a log.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  updateUserById: vi.fn(),
  ownerRow: { data: { owner_user_id: "owner-1" }, error: null } as {
    data: { owner_user_id: string } | null;
    error: { message: string } | null;
  },
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
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve(mocks.ownerRow),
        }),
      }),
    }),
    auth: { admin: { updateUserById: mocks.updateUserById } },
  }),
}));

import { POST } from "./route";

const NEW_PASSWORD = "correct-horse";

function call(body: unknown) {
  const request = new Request(
    "http://localhost/api/admin/accounts/acct-1/password",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return POST(request, { params: Promise.resolve({ id: "acct-1" }) });
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.resolvePlatformOperator.mockReset();
  mocks.updateUserById.mockReset();
  mocks.ownerRow = { data: { owner_user_id: "owner-1" }, error: null };
  mocks.getUser.mockResolvedValue({
    data: { user: { email: "ops@effect.dev" } },
  });
  mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
  mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
});

describe("POST /api/admin/accounts/[id]/password", () => {
  it("rejects an unauthenticated request and writes nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await call({ password: NEW_PASSWORD });
    expect(res.status).toBe(401);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("rejects a non-operator session and writes nothing", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(null);
    const res = await call({ password: NEW_PASSWORD });
    expect(res.status).toBe(403);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("sets the owner's password", async () => {
    const res = await call({ password: NEW_PASSWORD });
    expect(res.status).toBe(200);
    expect(mocks.updateUserById).toHaveBeenCalledWith("owner-1", {
      password: NEW_PASSWORD,
    });
  });

  it("never returns the password", async () => {
    const res = await call({ password: NEW_PASSWORD });
    const json = await res.json();
    expect(json).toEqual({ ok: true });
    expect(JSON.stringify(json)).not.toContain(NEW_PASSWORD);
  });

  it("never logs the password", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.updateUserById.mockResolvedValue({
      data: null,
      error: { message: "Password should be at least 6 characters" },
    });

    const res = await call({ password: NEW_PASSWORD });

    expect(res.status).toBe(400);
    for (const call of spy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(NEW_PASSWORD);
    }
    spy.mockRestore();
  });

  it("refuses a password below the minimum before writing anything", async () => {
    const res = await call({ password: "abc" });
    expect(res.status).toBe(400);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("refuses a body with no password", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that is not an account", async () => {
    mocks.ownerRow = { data: null, error: null };
    const res = await call({ password: NEW_PASSWORD });
    expect(res.status).toBe(404);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });
});
