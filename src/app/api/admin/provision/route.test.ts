import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", () => ({
  resolvePlatformOperator: mocks.resolvePlatformOperator,
}));

vi.mock("@/lib/provisioning/provision", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/provisioning/provision")
  >("@/lib/provisioning/provision");
  return {
    ...actual,
    provision: mocks.provision,
  };
});

import { POST } from "./route";

const VALID_BODY = {
  clinicName: "Clínica Teste",
  clientFullName: "Jane Doe",
  clientEmail: "jane@example.com",
  clientPassword: "correct-horse",
  specialty: "dentist",
  funnelModel: "model-1",
  persona: "Friendly dental assistant",
  metaDatasetId: "dataset-1",
  metaAccessToken: "token-1",
};

function request(body: unknown) {
  return new Request("http://localhost/api/admin/provision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.resolvePlatformOperator.mockReset();
  mocks.provision.mockReset();
});

describe("POST /api/admin/provision", () => {
  it("rejects an unauthenticated request and creates nothing", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(401);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("rejects a session whose e-mail is not on the allow-list and creates nothing", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "not-an-admin@example.com" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue(null);

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(403);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  // tasks.md 1.3 — the address and the password are the only two the
  // route still refuses to do without.
  it.each([["clientEmail"], ["clientPassword"]])(
    "rejects a submission with no %s before provisioning",
    async (field) => {
      mocks.getUser.mockResolvedValue({
        data: { user: { email: "ops@effect.dev" } },
      });
      mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

      const response = await POST(request({ ...VALID_BODY, [field]: "" }));

      expect(response.status).toBe(400);
      expect(mocks.provision).not.toHaveBeenCalled();
    },
  );

  it("provisions from an address, a password, a specialty and a funnel model", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
    mocks.provision.mockResolvedValue({ email: "cliente1@effect.com" });

    const response = await POST(
      request({
        clientEmail: "cliente1@effect.com",
        clientPassword: "correct-horse",
        specialty: "dentist",
        funnelModel: "model-1",
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        clientEmail: "cliente1@effect.com",
        clinicName: undefined,
        clientFullName: undefined,
        specialty: "dentist",
        funnelModel: "model-1",
        persona: "",
      }),
    );
  });

  it("still refuses a specialty it has no template for", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

    const response = await POST(
      request({ ...VALID_BODY, specialty: "astrologer" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it.each([["specialty"], ["funnelModel"]])(
    "rejects a submission with no %s before provisioning",
    async (field) => {
      mocks.getUser.mockResolvedValue({
        data: { user: { email: "ops@effect.dev" } },
      });
      mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

      const response = await POST(request({ ...VALID_BODY, [field]: "" }));

      expect(response.status).toBe(400);
      expect(mocks.provision).not.toHaveBeenCalled();
    },
  );

  it("rejects an unrecognised funnel model", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

    const response = await POST(request({ ...VALID_BODY, funnelModel: "model-9" }));

    expect(response.status).toBe(400);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("rejects 'other' with blank free text", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

    const response = await POST(
      request({ ...VALID_BODY, specialty: "other", specialtyOther: "" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("accepts 'other' with its free text", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
    mocks.provision.mockResolvedValue({ email: VALID_BODY.clientEmail });

    const response = await POST(
      request({ ...VALID_BODY, specialty: "other", specialtyOther: "quiropraxia" }),
    );

    expect(response.status).toBe(201);
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({ specialty: "other", specialtyOther: "quiropraxia" }),
    );
  });

  it("provisions successfully when both Meta fields are omitted", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
    mocks.provision.mockResolvedValue({ email: VALID_BODY.clientEmail });

    const { metaDatasetId, metaAccessToken, ...withoutMeta } = VALID_BODY;
    void metaDatasetId;
    void metaAccessToken;
    const response = await POST(request(withoutMeta));

    expect(response.status).toBe(201);
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({ metaDatasetId: undefined, metaAccessToken: undefined }),
    );
  });

  // admin-console tasks.md 5.2 — the event name goes through the same
  // module the edit surface uses, and a rejected one must create
  // nothing at all.
  it("rejects an invalid event name before provisioning", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

    const response = await POST(
      request({ ...VALID_BODY, metaEventName: "Lead conversion!" }),
    );

    expect(response.status).toBe(400);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("passes the Page id and event name through when supplied", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
    mocks.provision.mockResolvedValue({ email: VALID_BODY.clientEmail });

    const response = await POST(
      request({ ...VALID_BODY, metaPageId: "page-1", metaEventName: "Purchase" }),
    );

    expect(response.status).toBe(201);
    expect(mocks.provision).toHaveBeenCalledWith(
      expect.objectContaining({ metaPageId: "page-1", metaEventName: "Purchase" }),
    );
  });

  it("provisions and returns only the e-mail on success, never the password", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
    mocks.provision.mockResolvedValue({ email: VALID_BODY.clientEmail });

    const response = await POST(request(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toEqual({ email: VALID_BODY.clientEmail });
    expect(JSON.stringify(json)).not.toContain(VALID_BODY.clientPassword);
  });

  it("surfaces the failing step and survivors from a ProvisionError", async () => {
    const { ProvisionError } = await vi.importActual<
      typeof import("@/lib/provisioning/provision")
    >("@/lib/provisioning/provision");

    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });
    mocks.provision.mockRejectedValue(
      new ProvisionError("provision_gateway", "gateway unreachable", {
        authUserId: "user-1",
      }),
    );

    const response = await POST(request(VALID_BODY));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.step).toBe("provision_gateway");
    expect(json.survivors).toEqual({ authUserId: "user-1" });
  });
});
