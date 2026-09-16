import { afterEach, describe, expect, it } from "vitest";
import { isPlatformAdmin } from "./platform-admins";

afterEach(() => {
  delete process.env.PLATFORM_ADMINS;
});

describe("isPlatformAdmin", () => {
  it("matches nobody when PLATFORM_ADMINS is unset", () => {
    delete process.env.PLATFORM_ADMINS;
    expect(isPlatformAdmin("ops@effect.dev")).toBe(false);
  });

  it("matches nobody when PLATFORM_ADMINS is empty", () => {
    process.env.PLATFORM_ADMINS = "";
    expect(isPlatformAdmin("ops@effect.dev")).toBe(false);
  });

  it("matches a single listed address", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    expect(isPlatformAdmin("ops@effect.dev")).toBe(true);
    expect(isPlatformAdmin("someone.else@effect.dev")).toBe(false);
  });

  it("trims spaces around a comma-separated list", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev, sales@effect.dev , cs@effect.dev";
    expect(isPlatformAdmin("sales@effect.dev")).toBe(true);
    expect(isPlatformAdmin("cs@effect.dev")).toBe(true);
  });

  it("compares case-insensitively", () => {
    process.env.PLATFORM_ADMINS = "Ops@Effect.Dev";
    expect(isPlatformAdmin("ops@effect.dev")).toBe(true);
    expect(isPlatformAdmin("OPS@EFFECT.DEV")).toBe(true);
  });

  it("rejects a null/undefined/empty caller email", () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
    expect(isPlatformAdmin("")).toBe(false);
  });
});
