import { beforeEach, describe, expect, it, vi } from "vitest";

// tasks.md 5.3 — an operator is turned away before getCurrentAccount()
// ever runs, since handle_new_user already gave them an account of
// their own that call would otherwise resolve successfully.

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  resolvePlatformOperator: vi.fn(),
  getCurrentAccount: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/provisioning/platform-admins", () => ({
  resolvePlatformOperator: mocks.resolvePlatformOperator,
}));

vi.mock("@/lib/auth/account", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/account")>(
    "@/lib/auth/account",
  );
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
  };
});

import { AccountSuspendedError } from "@/lib/auth/account";
import DashboardLayout from "./layout";

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.resolvePlatformOperator.mockReset();
  mocks.getCurrentAccount.mockReset();
  mocks.redirect.mockClear();

  mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  mocks.getCurrentAccount.mockResolvedValue({});
});

describe("DashboardLayout", () => {
  it("redirects an operator to /admin without calling getCurrentAccount", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue({ role: "admin", seeded: false });

    await expect(DashboardLayout({ children: null })).rejects.toThrow("/admin");

    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
    expect(mocks.getCurrentAccount).not.toHaveBeenCalled();
  });

  it("redirects a suspended member to /login?suspended=1", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(null);
    mocks.getCurrentAccount.mockRejectedValue(new AccountSuspendedError());

    await expect(DashboardLayout({ children: null })).rejects.toThrow("suspended=1");

    expect(mocks.redirect).toHaveBeenCalledWith("/login?suspended=1");
  });

  it("renders the shell for an ordinary client with no redirect", async () => {
    mocks.resolvePlatformOperator.mockResolvedValue(null);

    const result = await DashboardLayout({ children: null });

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(result).toBeTruthy();
  });
});
