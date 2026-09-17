import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  isPlatformAdmin: vi.fn(),
  provision: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", () => ({
  isPlatformAdmin: mocks.isPlatformAdmin,
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
  mocks.isPlatformAdmin.mockReset();
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
    mocks.isPlatformAdmin.mockReturnValue(false);

    const response = await POST(request(VALID_BODY));

    expect(response.status).toBe(403);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("rejects a submission missing required fields before provisioning", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.isPlatformAdmin.mockReturnValue(true);

    const response = await POST(request({ ...VALID_BODY, clinicName: "" }));

    expect(response.status).toBe(400);
    expect(mocks.provision).not.toHaveBeenCalled();
  });

  it("provisions successfully when both Meta fields are omitted", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.isPlatformAdmin.mockReturnValue(true);
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

  it("provisions and returns only the e-mail on success, never the password", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { email: "ops@effect.dev" } },
    });
    mocks.isPlatformAdmin.mockReturnValue(true);
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
    mocks.isPlatformAdmin.mockReturnValue(true);
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
