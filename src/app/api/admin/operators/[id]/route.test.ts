import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// tasks.md 4.6/4.7 — removal deletes the operator record only, never
// the sign-in identity, and never a seeded address.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  select: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/provisioning/platform-admins")
  >("@/lib/provisioning/platform-admins");
  return {
    ...actual,
    resolvePlatformOperator: mocks.resolvePlatformOperator,
  };
});

vi.mock("@/lib/provisioning/admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.select }) }),
      delete: () => ({ eq: mocks.delete }),
    }),
  }),
}));

import { DELETE } from "./route";

const MANAGER = { role: "manager" as const, seeded: false };
const ADMIN_ROLE = { role: "admin" as const, seeded: false };

function call(id: string) {
  const request = new Request(`http://localhost/api/admin/operators/${id}`, {
    method: "DELETE",
  });
  return DELETE(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.resolvePlatformOperator.mockReset();
  mocks.select.mockReset();
  mocks.delete.mockReset();

  mocks.getUser.mockResolvedValue({ data: { user: { id: "mgr-1", email: "mgr@effect.dev" } } });
  mocks.resolvePlatformOperator.mockResolvedValue(MANAGER);
  mocks.select.mockResolvedValue({ data: { email: "admin@effect.dev" }, error: null });
  mocks.delete.mockResolvedValue({ error: null });
});

afterEach(() => {
  delete process.env.PLATFORM_ADMINS;
});

describe("DELETE /api/admin/operators/[id]", () => {
  it("rejects an unauthenticated request and writes nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await call("op-1");
    expect(res.status).toBe(401);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("rejects an admin-role operator and writes nothing", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(ADMIN_ROLE);
    const res = await call("op-1");
    expect(res.status).toBe(403);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("refuses self-removal and writes nothing", async () => {
    const res = await call("mgr-1");
    expect(res.status).toBe(400);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("answers 404 for an id with no operator record", async () => {
    mocks.select.mockResolvedValue({ data: null, error: null });
    const res = await call("nobody");
    expect(res.status).toBe(404);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("refuses to remove a seeded address and writes nothing", async () => {
    process.env.PLATFORM_ADMINS = "admin@effect.dev";
    const res = await call("op-1");
    expect(res.status).toBe(400);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("deletes the record for an ordinary operator", async () => {
    const res = await call("op-1");
    expect(res.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith("user_id", "op-1");
  });
});
