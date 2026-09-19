import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSeedOperatorEmails,
  isManager,
  isSeededOperatorEmail,
  resolvePlatformOperator,
} from "./platform-admins";

afterEach(() => {
  delete process.env.PLATFORM_ADMINS;
});

/** Stubs the one query `resolvePlatformOperator` ever runs. */
function stubClient(result: { data: { role: string } | null; error: unknown } | (() => never)) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (typeof result === "function") return result();
            return result;
          },
        }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("isSeededOperatorEmail / getSeedOperatorEmails", () => {
  it("matches nobody when PLATFORM_ADMINS is unset", () => {
    delete process.env.PLATFORM_ADMINS;
    expect(isSeededOperatorEmail("ops@effect.dev")).toBe(false);
    expect(getSeedOperatorEmails()).toEqual([]);
  });

  it("matches nobody when PLATFORM_ADMINS is empty", () => {
    process.env.PLATFORM_ADMINS = "";
    expect(isSeededOperatorEmail("ops@effect.dev")).toBe(false);
  });

  it("matches a single listed address", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    expect(isSeededOperatorEmail("ops@effect.dev")).toBe(true);
    expect(isSeededOperatorEmail("someone.else@effect.dev")).toBe(false);
  });

  it("trims spaces around a comma-separated list", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev, sales@effect.dev , cs@effect.dev";
    expect(isSeededOperatorEmail("sales@effect.dev")).toBe(true);
    expect(isSeededOperatorEmail("cs@effect.dev")).toBe(true);
  });

  it("compares case-insensitively", () => {
    process.env.PLATFORM_ADMINS = "Ops@Effect.Dev";
    expect(isSeededOperatorEmail("ops@effect.dev")).toBe(true);
    expect(isSeededOperatorEmail("OPS@EFFECT.DEV")).toBe(true);
  });

  it("rejects a null/undefined/empty caller email", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    expect(isSeededOperatorEmail(null)).toBe(false);
    expect(isSeededOperatorEmail(undefined)).toBe(false);
    expect(isSeededOperatorEmail("")).toBe(false);
  });

  it("de-duplicates", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev, OPS@Effect.dev";
    expect(getSeedOperatorEmails()).toEqual(["ops@effect.dev"]);
  });
});

describe("resolvePlatformOperator", () => {
  it("resolves nobody with no session", async () => {
    const client = stubClient({ data: null, error: null });
    expect(await resolvePlatformOperator(client, null)).toBeNull();
  });

  it("resolves a seeded address as manager with no query", async () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    const from = vi.fn();
    const client = { from } as unknown as Parameters<typeof resolvePlatformOperator>[0];

    const result = await resolvePlatformOperator(client, {
      id: "user-1",
      email: "ops@effect.dev",
    });

    expect(result).toEqual({ role: "manager", seeded: true });
    expect(from).not.toHaveBeenCalled();
  });

  it("resolves a recorded address to its stored role", async () => {
    const client = stubClient({ data: { role: "admin" }, error: null });

    const result = await resolvePlatformOperator(client, {
      id: "user-2",
      email: "admin@effect.dev",
    });

    expect(result).toEqual({ role: "admin", seeded: false });
  });

  it("resolves an unknown address to null", async () => {
    const client = stubClient({ data: null, error: null });

    const result = await resolvePlatformOperator(client, {
      id: "user-3",
      email: "nobody@effect.dev",
    });

    expect(result).toBeNull();
  });

  // tasks.md 2.2 — the seed must not depend on the table being reachable.
  it("still resolves a seeded address when the table lookup fails", async () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    const client = stubClient(() => {
      throw new Error("connection refused");
    });

    const result = await resolvePlatformOperator(client, {
      id: "user-1",
      email: "ops@effect.dev",
    });

    expect(result).toEqual({ role: "manager", seeded: true });
  });

  it("resolves an unrecorded address to null when the table lookup errors", async () => {
    const client = stubClient({ data: null, error: new Error("connection refused") });

    const result = await resolvePlatformOperator(client, {
      id: "user-3",
      email: "nobody@effect.dev",
    });

    expect(result).toBeNull();
  });

  // tasks.md 2.3 — empty seed + empty table still resolves nobody.
  it("resolves nobody when the seed is empty and the table has no row", async () => {
    delete process.env.PLATFORM_ADMINS;
    const client = stubClient({ data: null, error: null });

    const result = await resolvePlatformOperator(client, {
      id: "user-4",
      email: "anyone@effect.dev",
    });

    expect(result).toBeNull();
  });
});

describe("isManager", () => {
  it("is true only for the manager role", () => {
    expect(isManager({ role: "manager", seeded: false })).toBe(true);
    expect(isManager({ role: "manager", seeded: true })).toBe(true);
    expect(isManager({ role: "admin", seeded: false })).toBe(false);
    expect(isManager(null)).toBe(false);
  });
});
