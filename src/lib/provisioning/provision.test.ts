import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ordered log of the calls that matter for these tests, so rollback
// order (accounts delete BEFORE auth deleteUser) is assertable.
let calls: string[] = [];

let profileAccountId: string | null = "acct-1";
let pipelineInsertFails = false;
let accountsDeleteFails = false;
let gatewayFails = false;
let lastWhatsappConfigUpdate: Record<string, unknown> | null = null;

vi.mock("@/lib/whatsapp/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
}));

const provisionInstanceMock = vi.fn(async (args: unknown) => {
  void args;
  calls.push("provisionInstance");
  if (gatewayFails) throw new Error("gateway unreachable");
  return { instanceId: "inst-1", reused: false };
});
vi.mock("@/lib/whatsapp/instance", () => ({
  provisionInstance: (args: unknown) => provisionInstanceMock(args),
}));

function makeDb() {
  return {
    auth: {
      admin: {
        createUser: vi.fn(async () => {
          calls.push("auth:createUser");
          return { data: { user: { id: "user-1" } }, error: null };
        }),
        deleteUser: vi.fn(async () => {
          calls.push("auth:deleteUser");
          return { data: {}, error: null };
        }),
      },
    },
    from(table: string) {
      let mode: "select" | "insert" | "update" | "delete" = "select";

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      builder.select = () => builder;
      builder.insert = () => {
        mode = "insert";
        return builder;
      };
      builder.update = (vals: Record<string, unknown>) => {
        mode = "update";
        if (table === "whatsapp_config") lastWhatsappConfigUpdate = vals;
        return builder;
      };
      builder.delete = () => {
        mode = "delete";
        return builder;
      };
      builder.eq = () => builder;

      async function resolve() {
        if (table === "profiles") {
          return {
            data: profileAccountId ? { account_id: profileAccountId } : null,
            error: null,
          };
        }
        if (table === "accounts" && mode === "delete") {
          calls.push("accounts:delete");
          if (accountsDeleteFails) {
            return { data: null, error: { message: "account delete failed" } };
          }
          return { data: null, error: null };
        }
        if (table === "accounts" && mode === "update") {
          return { data: null, error: null };
        }
        if (table === "pipelines" && mode === "insert") {
          if (pipelineInsertFails) {
            return { data: null, error: { message: "pipeline insert failed" } };
          }
          return { data: { id: "pipe-1" }, error: null };
        }
        if (table === "pipeline_stages" && mode === "insert") {
          return {
            data: [
              { id: "stage-0", is_system: true },
              { id: "stage-1", is_system: false },
            ],
            error: null,
          };
        }
        if (table === "ai_configs" && mode === "insert") {
          return { data: null, error: null };
        }
        if (table === "whatsapp_config" && mode === "update") {
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }

      builder.single = () => resolve();
      builder.maybeSingle = () => resolve();
      // Makes the builder itself awaitable for chains with no
      // .single()/.maybeSingle() terminator (e.g. insert().select()).
      builder.then = (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) => resolve().then(onFulfilled, onRejected);

      return builder;
    },
  };
}

vi.mock("./admin-client", () => ({ supabaseAdmin: () => makeDb() }));

const INPUT = {
  clinicName: "Clínica Teste",
  clientFullName: "Jane Doe",
  clientEmail: "jane@example.com",
  clientPassword: "correct-horse",
  specialty: "dentist" as const,
  persona: "Friendly dental assistant",
  metaDatasetId: "dataset-1",
  metaAccessToken: "token-1",
};

beforeEach(() => {
  calls = [];
  profileAccountId = "acct-1";
  pipelineInsertFails = false;
  accountsDeleteFails = false;
  gatewayFails = false;
  lastWhatsappConfigUpdate = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("provision", () => {
  it("fails and rolls back when the profile bootstrap never landed", async () => {
    const { provision, ProvisionError } = await import("./provision");
    profileAccountId = null;

    let caught: unknown;
    try {
      await provision(INPUT);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ProvisionError);
    expect((caught as InstanceType<typeof ProvisionError>).step).toBe(
      "read_profile",
    );
    // No account existed yet — only the auth user is undone.
    expect(calls.filter((c) => c === "auth:deleteUser")).toHaveLength(1);
    expect(calls.filter((c) => c === "accounts:delete")).toHaveLength(0);
  });

  it("rolls back accounts before the auth user when seeding the pipeline fails", async () => {
    const { provision } = await import("./provision");
    pipelineInsertFails = true;

    await expect(provision(INPUT)).rejects.toMatchObject({
      step: "seed_pipeline",
    });

    const deleteIndex = calls.indexOf("accounts:delete");
    const userDeleteIndex = calls.indexOf("auth:deleteUser");
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(userDeleteIndex).toBeGreaterThan(deleteIndex);
  });

  it("rolls back accounts then the auth user when the gateway step fails, leaving no account", async () => {
    const { provision } = await import("./provision");
    gatewayFails = true;

    await expect(provision(INPUT)).rejects.toMatchObject({
      step: "provision_gateway",
    });

    const deleteIndex = calls.indexOf("accounts:delete");
    const userDeleteIndex = calls.indexOf("auth:deleteUser");
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(userDeleteIndex).toBeGreaterThan(deleteIndex);
  });

  it("reports survivors when cleanup itself fails", async () => {
    const { provision } = await import("./provision");
    pipelineInsertFails = true;
    accountsDeleteFails = true;

    await expect(provision(INPUT)).rejects.toMatchObject({
      step: "seed_pipeline",
      survivors: { authUserId: "user-1", accountId: "acct-1" },
    });
    // The auth user was never reached because the account delete failed first.
    expect(calls.filter((c) => c === "auth:deleteUser")).toHaveLength(0);
  });

  it("points whatsapp_config's inbound defaults at the seeded pipeline and system stage", async () => {
    const { provision } = await import("./provision");

    const result = await provision(INPUT);

    expect(result).toEqual({ email: INPUT.clientEmail });
    expect(lastWhatsappConfigUpdate).toEqual({
      inbound_default_pipeline_id: "pipe-1",
      inbound_default_stage_id: "stage-0",
    });
  });
});
