import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Ordered log of the calls that matter for these tests, so rollback
// order (accounts delete BEFORE auth deleteUser) is assertable.
let calls: string[] = [];

let profileAccountId: string | null = "acct-1";
let pipelineInsertFails = false;
let accountsDeleteFails = false;
let gatewayFails = false;
let lastWhatsappConfigUpdate: Record<string, unknown> | null = null;
let lastAccountsUpdate: Record<string, unknown> | null = null;
let lastPipelineInsert: Record<string, unknown> | null = null;
let lastStagesInsert: Record<string, unknown>[] | null = null;
let lastAiConfigInsert: Record<string, unknown> | null = null;
let lastCreateUserArgs: Record<string, unknown> | null = null;

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
        createUser: vi.fn(async (args: Record<string, unknown>) => {
          calls.push("auth:createUser");
          lastCreateUserArgs = args;
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
      builder.insert = (vals: Record<string, unknown> | Record<string, unknown>[]) => {
        mode = "insert";
        if (table === "pipelines") lastPipelineInsert = vals as Record<string, unknown>;
        if (table === "pipeline_stages") {
          lastStagesInsert = vals as Record<string, unknown>[];
        }
        if (table === "ai_configs") lastAiConfigInsert = vals as Record<string, unknown>;
        return builder;
      };
      builder.update = (vals: Record<string, unknown>) => {
        mode = "update";
        if (table === "whatsapp_config") lastWhatsappConfigUpdate = vals;
        if (table === "accounts") lastAccountsUpdate = vals;
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
  funnelModel: "model-1" as const,
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
  lastAccountsUpdate = null;
  lastPipelineInsert = null;
  lastStagesInsert = null;
  lastAiConfigInsert = null;
  lastCreateUserArgs = null;
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

  // tasks.md 5.1 — metaDatasetId/metaAccessToken are optional at
  // provisioning time; omitted fields must be left off the accounts
  // update entirely, not written as empty strings.
  describe("optional Meta advertising fields", () => {
    it("provisions with both dataset id and access token", async () => {
      const { provision } = await import("./provision");
      await provision(INPUT);
      expect(lastAccountsUpdate).toEqual({
        name: INPUT.clinicName,
        specialty: "dentist",
        specialty_other: null,
        meta_dataset_id: "dataset-1",
        meta_access_token: "enc:token-1",
      });
    });

    it("provisions with only the dataset id", async () => {
      const { provision } = await import("./provision");
      await provision({ ...INPUT, metaDatasetId: "dataset-1", metaAccessToken: undefined });
      expect(lastAccountsUpdate).toEqual({
        name: INPUT.clinicName,
        specialty: "dentist",
        specialty_other: null,
        meta_dataset_id: "dataset-1",
      });
    });

    it("provisions with neither Meta field", async () => {
      const { provision } = await import("./provision");
      await provision({ ...INPUT, metaDatasetId: undefined, metaAccessToken: undefined });
      expect(lastAccountsUpdate).toEqual({
        name: INPUT.clinicName,
        specialty: "dentist",
        specialty_other: null,
      });
    });

    // admin-console tasks.md 5.1 — the Page id and the event name join
    // the form so an account leaves it fully configured, and stay
    // optional like the other two.
    it("provisions with all four advertising fields", async () => {
      const { provision } = await import("./provision");
      await provision({ ...INPUT, metaPageId: "page-1", metaEventName: "Purchase" });
      expect(lastAccountsUpdate).toEqual({
        name: INPUT.clinicName,
        specialty: "dentist",
        specialty_other: null,
        meta_dataset_id: "dataset-1",
        meta_access_token: "enc:token-1",
        meta_page_id: "page-1",
        meta_event_name: "Purchase",
      });
    });

    it("leaves the Page id and event name off the update when absent", async () => {
      const { provision } = await import("./provision");
      await provision(INPUT);
      expect(lastAccountsUpdate).not.toHaveProperty("meta_page_id");
      expect(lastAccountsUpdate).not.toHaveProperty("meta_event_name");
    });

    it("never writes a test event code", async () => {
      const { provision } = await import("./provision");
      await provision({ ...INPUT, metaPageId: "page-1", metaEventName: "Lead" });
      expect(lastAccountsUpdate).not.toHaveProperty("meta_test_event_code");
    });
  });

  // tasks.md 1.1/1.2 — an address, a password, a specialty and a funnel
  // model are the whole required input; everything else resolves to a
  // default in one place. (provisioning spec.md, "Address and password
  // alone provision an account" — the scenario name predates the split;
  // specialty and funnelModel are required, non-defaulted inputs.)
  describe("address and password alone", () => {
    const MINIMAL = {
      clientEmail: "cliente1@effect.com",
      clientPassword: "correct-horse",
      specialty: "dentist" as const,
      funnelModel: "model-1" as const,
    };

    it("names the account after the e-mail's local part", async () => {
      const { provision } = await import("./provision");
      await provision(MINIMAL);
      expect(lastAccountsUpdate).toEqual({
        name: "cliente1",
        specialty: "dentist",
        specialty_other: null,
      });
      expect(lastPipelineInsert).toMatchObject({ name: "Funil de vendas" });
    });

    it("reuses that name for the sign-in identity's full name", async () => {
      const { provision } = await import("./provision");
      await provision(MINIMAL);
      expect(lastCreateUserArgs).toMatchObject({
        user_metadata: { full_name: "cliente1" },
      });
    });

    it("seeds the chosen funnel model's stages", async () => {
      const { provision } = await import("./provision");
      const { FUNNEL_MODELS } = await import("./templates");
      await provision(MINIMAL);
      expect((lastStagesInsert ?? []).map((s) => s.name)).toEqual(
        FUNNEL_MODELS["model-1"].map((s) => s.name),
      );
    });

    it("stores 'other' with its free text and drops it for a listed specialty", async () => {
      const { provision } = await import("./provision");
      await provision({ ...MINIMAL, specialty: "other", specialtyOther: "quiropraxia" });
      expect(lastAccountsUpdate).toEqual({
        name: "cliente1",
        specialty: "other",
        specialty_other: "quiropraxia",
      });

      await provision({ ...MINIMAL, specialty: "dentist", specialtyOther: "quiropraxia" });
      expect(lastAccountsUpdate).toEqual({
        name: "cliente1",
        specialty: "dentist",
        specialty_other: null,
      });
    });

    it("creates the assistant with an empty persona", async () => {
      const { provision } = await import("./provision");
      await provision(MINIMAL);
      expect(lastAiConfigInsert).toMatchObject({
        system_prompt: "",
        auto_reply_enabled: false,
      });
    });

    it("prefers a supplied clinic name over the fallback", async () => {
      const { provision } = await import("./provision");
      await provision({ ...MINIMAL, clinicName: "Clínica Teste" });
      expect(lastAccountsUpdate).toEqual({
        name: "Clínica Teste",
        specialty: "dentist",
        specialty_other: null,
      });
      // pipeline name never varies with the clinic name (design.md D4)
      expect(lastPipelineInsert).toMatchObject({ name: "Funil de vendas" });
    });

    it("ignores a whitespace-only clinic name", async () => {
      const { provision } = await import("./provision");
      await provision({ ...MINIMAL, clinicName: "   " });
      expect(lastAccountsUpdate).toEqual({
        name: "cliente1",
        specialty: "dentist",
        specialty_other: null,
      });
    });

    it("rolls back cleanly when the gateway fails on a minimal provision", async () => {
      const { provision, ProvisionError } = await import("./provision");
      gatewayFails = true;

      let caught: unknown;
      try {
        await provision(MINIMAL);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(ProvisionError);
      expect((caught as InstanceType<typeof ProvisionError>).step).toBe(
        "provision_gateway",
      );
      expect(calls.filter((c) => c === "accounts:delete")).toHaveLength(1);
      expect(calls.filter((c) => c === "auth:deleteUser")).toHaveLength(1);
    });
  });

  // tasks.md 1.2 — the fallback must never produce an empty name.
  describe("accountNameFromEmail", () => {
    it("takes the local part", async () => {
      const { accountNameFromEmail } = await import("./provision");
      expect(accountNameFromEmail("cliente1@effect.com")).toBe("cliente1");
    });

    it("falls back to the whole address when the local part has no letter or digit", async () => {
      const { accountNameFromEmail } = await import("./provision");
      expect(accountNameFromEmail("...@effect.com")).toBe("...@effect.com");
      expect(accountNameFromEmail("-@effect.com")).toBe("-@effect.com");
    });

    it("keeps non-ASCII local parts", async () => {
      const { accountNameFromEmail } = await import("./provision");
      expect(accountNameFromEmail("josé@effect.com")).toBe("josé");
    });
  });
});
