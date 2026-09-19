import { beforeEach, describe, expect, it, vi } from "vitest";

// tasks.md 4.1–4.5 — the operator register: listing, and registering
// either a brand-new identity or adopting a removed operator's
// existing one.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  listOperators: vi.fn(),
  operatorSelect: vi.fn(),
  profileSelect: vi.fn(),
  insert: vi.fn(),
  createUser: vi.fn(),
  deleteUser: vi.fn(),
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

vi.mock("@/lib/admin/operators", () => ({
  listOperators: mocks.listOperators,
}));

vi.mock("@/lib/provisioning/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === "platform_operators") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mocks.operatorSelect }) }),
          insert: mocks.insert,
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({ ilike: () => ({ maybeSingle: mocks.profileSelect }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
  }),
}));

import { GET, POST } from "./route";

const MANAGER = { role: "manager" as const, seeded: false };
const ADMIN_ROLE = { role: "admin" as const, seeded: false };

function registerRequest(body: unknown) {
  return new Request("http://localhost/api/admin/operators", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  name: "Jane Doe",
  email: "jane@effect.dev",
  role: "admin",
  password: "correct-horse",
};

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.resolvePlatformOperator.mockReset();
  mocks.listOperators.mockReset();
  mocks.operatorSelect.mockReset();
  mocks.profileSelect.mockReset();
  mocks.insert.mockReset();
  mocks.createUser.mockReset();
  mocks.deleteUser.mockReset();

  mocks.getUser.mockResolvedValue({ data: { user: { id: "mgr-1", email: "mgr@effect.dev" } } });
  mocks.resolvePlatformOperator.mockResolvedValue(MANAGER);
  mocks.operatorSelect.mockResolvedValue({ data: null, error: null });
  mocks.profileSelect.mockResolvedValue({ data: null, error: null });
  mocks.insert.mockResolvedValue({ error: null });
  mocks.createUser.mockResolvedValue({ data: { user: { id: "new-user-1" } }, error: null });
});

describe("GET /api/admin/operators", () => {
  it("rejects an unauthenticated request", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("rejects an admin-role operator", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(ADMIN_ROLE);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(mocks.listOperators).not.toHaveBeenCalled();
  });

  it("returns the register for a manager", async () => {
    mocks.listOperators.mockResolvedValue([
      { userId: "u1", email: "a@effect.dev", fullName: "A", role: "admin", seeded: false, createdByName: "Mgr", createdAt: "2026-01-01" },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.operators).toHaveLength(1);
  });
});

describe("POST /api/admin/operators", () => {
  it("rejects an unauthenticated request and creates nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(registerRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("rejects an admin-role operator and creates nothing", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(ADMIN_ROLE);
    const res = await POST(registerRequest(VALID_BODY));
    expect(res.status).toBe(403);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it.each([["name"], ["email"]])("rejects a submission with no %s", async (field) => {
    const res = await POST(registerRequest({ ...VALID_BODY, [field]: "" }));
    expect(res.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("rejects an invalid role", async () => {
    const res = await POST(registerRequest({ ...VALID_BODY, role: "owner" }));
    expect(res.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("refuses an address that already holds an operator record", async () => {
    mocks.operatorSelect.mockResolvedValue({ data: { user_id: "existing-1" }, error: null });
    const res = await POST(registerRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("refuses a weak password when a new identity must be created", async () => {
    const res = await POST(registerRequest({ ...VALID_BODY, password: "abc" }));
    expect(res.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
  });

  it("creates the identity and the record, reporting the password was set", async () => {
    const res = await POST(registerRequest(VALID_BODY));
    expect(res.status).toBe(201);
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@effect.dev", password: "correct-horse", email_confirm: true }),
    );
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "new-user-1",
        email: "jane@effect.dev",
        role: "admin",
        created_by: "mgr-1",
      }),
    );
    const json = await res.json();
    expect(json).toEqual({ passwordUnchanged: false });
    expect(JSON.stringify(json)).not.toContain(VALID_BODY.password);
  });

  it("adopts a removed operator's existing identity without a password", async () => {
    mocks.profileSelect.mockResolvedValue({ data: { user_id: "returning-1" }, error: null });
    const res = await POST(registerRequest({ ...VALID_BODY, password: "" }));
    expect(res.status).toBe(201);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "returning-1" }),
    );
    expect(await res.json()).toEqual({ passwordUnchanged: true });
  });

  it("rolls back the created identity when the insert fails", async () => {
    mocks.insert.mockResolvedValue({ error: { message: "boom" } });
    const res = await POST(registerRequest(VALID_BODY));
    expect(res.status).toBe(500);
    expect(mocks.deleteUser).toHaveBeenCalledWith("new-user-1");
  });

  it("does not roll back an adopted identity when the insert fails", async () => {
    mocks.profileSelect.mockResolvedValue({ data: { user_id: "returning-1" }, error: null });
    mocks.insert.mockResolvedValue({ error: { message: "boom" } });
    const res = await POST(registerRequest({ ...VALID_BODY, password: "" }));
    expect(res.status).toBe(500);
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });
});
