import { beforeEach, describe, expect, it, vi } from "vitest";

// tasks.md 5.1–5.4 — the account row itself: its name and whether it is
// in service. Deactivating also cancels the conversions that were still
// waiting to be delivered (design.md D4).

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  update: vi.fn(),
  eventsUpdate: vi.fn(),
  eventsError: null as { message: string } | null,
  canceledRows: [] as { id: string }[],
  disconnectInstance: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", () => ({
  resolvePlatformOperator: mocks.resolvePlatformOperator,
}));

vi.mock("@/lib/whatsapp/instance", () => ({
  disconnectInstance: mocks.disconnectInstance,
  instanceName: (accountId: string) => `wacrm-${accountId}`,
}));

vi.mock("@/lib/provisioning/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => {
        if (table === "meta_capi_events") {
          const call = { patch, statuses: [] as string[] };
          return {
            eq: () => ({
              in: (_col: string, statuses: string[]) => {
                call.statuses = statuses;
                mocks.eventsUpdate(call);
                return {
                  select: () =>
                    Promise.resolve({
                      data: mocks.eventsError ? null : mocks.canceledRows,
                      error: mocks.eventsError,
                    }),
                };
              },
            }),
          };
        }
        mocks.update(table, patch);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  }),
}));

import { PATCH } from "./route";

function call(body: unknown) {
  const request = new Request("http://localhost/api/admin/accounts/acct-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ id: "acct-1" }) });
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.resolvePlatformOperator.mockReset();
  mocks.update.mockReset();
  mocks.eventsUpdate.mockReset();
  mocks.eventsError = null;
  mocks.canceledRows = [];
  mocks.disconnectInstance.mockReset();
  mocks.disconnectInstance.mockResolvedValue({ orphan: null });
  mocks.getUser.mockResolvedValue({
    data: { user: { email: "ops@effect.dev" } },
  });
  mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
});

describe("PATCH /api/admin/accounts/[id]", () => {
  it("rejects an unauthenticated request and writes nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const res = await call({ name: "Nova Clínica" });
    expect(res.status).toBe(401);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("rejects a non-operator session and writes nothing", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(null);
    const res = await call({ deactivated: true });
    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.eventsUpdate).not.toHaveBeenCalled();
  });

  describe("rename", () => {
    it("writes the trimmed name", async () => {
      const res = await call({ name: "  Nova Clínica  " });
      expect(res.status).toBe(200);
      expect(mocks.update).toHaveBeenCalledWith("accounts", {
        name: "Nova Clínica",
      });
    });

    it("refuses a blank name and writes nothing", async () => {
      const res = await call({ name: "   " });
      expect(res.status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    });

    it("refuses a name that is not a string", async () => {
      const res = await call({ name: 42 });
      expect(res.status).toBe(400);
      expect(mocks.update).not.toHaveBeenCalled();
    });
  });

  describe("deactivate", () => {
    it("stamps deactivated_at and cancels the undelivered conversions", async () => {
      mocks.canceledRows = [{ id: "e1" }, { id: "e2" }];

      const res = await call({ deactivated: true });

      expect(res.status).toBe(200);
      const [table, patch] = mocks.update.mock.calls[0];
      expect(table).toBe("accounts");
      expect(typeof patch.deactivated_at).toBe("string");

      expect(mocks.eventsUpdate).toHaveBeenCalledWith({
        patch: { status: "canceled" },
        statuses: ["pending", "unconfigured"],
      });
      await expect(res.json()).resolves.toMatchObject({
        ok: true,
        canceledConversions: 2,
      });
    });

    it("cancels nothing when the account has no waiting conversions", async () => {
      const res = await call({ deactivated: true });
      await expect(res.json()).resolves.toMatchObject({
        canceledConversions: 0,
      });
    });

    it("reports the account as deactivated when cancelling fails", async () => {
      mocks.eventsError = { message: "boom" };
      const res = await call({ deactivated: true });
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({
        deactivated: true,
        canceledConversions: null,
      });
    });

    it("tears down the account's instance once", async () => {
      await call({ deactivated: true });
      expect(mocks.disconnectInstance).toHaveBeenCalledTimes(1);
      const [, accountId] = mocks.disconnectInstance.mock.calls[0];
      expect(accountId).toBe("acct-1");
    });

    it("returns 200 with a warning naming the instance when the teardown reports an orphan", async () => {
      mocks.disconnectInstance.mockResolvedValue({
        orphan: { instanceId: "inst-1", name: "wacrm-acct-1" },
      });
      const res = await call({ deactivated: true });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; warning?: string };
      expect(json.ok).toBe(true);
      expect(json.warning).toContain("wacrm-acct-1");
      expect(json.warning).toContain("inst-1");
    });

    it("still returns 200 with a warning when the teardown throws", async () => {
      mocks.disconnectInstance.mockRejectedValue(new Error("db down"));
      const res = await call({ deactivated: true });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { ok: boolean; warning?: string };
      expect(json.ok).toBe(true);
      expect(json.warning).toContain("wacrm-acct-1");
    });

    it("lets the conversion-cancel warning win when both the cancel and the teardown fail", async () => {
      mocks.eventsError = { message: "boom" };
      mocks.disconnectInstance.mockResolvedValue({
        orphan: { instanceId: "inst-1", name: "wacrm-acct-1" },
      });
      const res = await call({ deactivated: true });
      const json = (await res.json()) as { warning?: string };
      expect(json.warning).toBe(
        "Conversions waiting to be delivered could not be cancelled",
      );
    });
  });

  describe("reactivate", () => {
    it("clears deactivated_at and cancels nothing", async () => {
      const res = await call({ deactivated: false });
      expect(res.status).toBe(200);
      expect(mocks.update).toHaveBeenCalledWith("accounts", {
        deactivated_at: null,
      });
      expect(mocks.eventsUpdate).not.toHaveBeenCalled();
    });

    it("calls no teardown", async () => {
      await call({ deactivated: false });
      expect(mocks.disconnectInstance).not.toHaveBeenCalled();
    });
  });

  it("refuses a body that asks for nothing", async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("renames and deactivates in one write", async () => {
    const res = await call({ name: "Clínica X", deactivated: true });
    expect(res.status).toBe(200);
    const [, patch] = mocks.update.mock.calls[0];
    expect(patch.name).toBe("Clínica X");
    expect(typeof patch.deactivated_at).toBe("string");
  });
});
