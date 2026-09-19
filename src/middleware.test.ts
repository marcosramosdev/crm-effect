import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// --- Scenario knobs the mock reads -----------------------------------------
// `mockUser`         — what getUser() resolves to (a refreshed session ⇒ user,
//                      or null for the logged-out path).
// `refreshedCookies` — cookies Supabase writes via setAll() during getUser(),
//                      i.e. the freshly *rotated* auth token. The whole point
//                      of the test is that these must survive onto whatever
//                      response the middleware returns — including redirects.
let mockUser: { id: string; email?: string } | null = null;
let refreshedCookies: Array<{
  name: string;
  value: string;
  options: Record<string, unknown>;
}> = [];
// Simulates the caller's own platform_operators row — null when they
// have none (the only query resolvePlatformOperator ever runs, once
// the env seed doesn't already match).
let mockOperatorRow: { role: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    opts: {
      cookies: { setAll: (c: typeof refreshedCookies) => void };
    },
  ) => ({
    auth: {
      // Mirrors real auth-js: an expired access token is transparently
      // refreshed inside getUser(), which rotates the refresh token and
      // pushes the new cookies through setAll() before resolving.
      getUser: async () => {
        if (refreshedCookies.length) opts.cookies.setAll(refreshedCookies);
        return { data: { user: mockUser } };
      },
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: mockOperatorRow, error: null }),
        }),
      }),
    }),
  }),
}));

// Imported after the mock is registered.
const { middleware } = await import("./middleware");

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  mockUser = null;
  refreshedCookies = [];
  mockOperatorRow = null;
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.PLATFORM_ADMINS;
});

const ROTATED = {
  name: "sb-test-auth-token",
  value: "rotated-refresh-token",
  options: { path: "/", httpOnly: true },
};

describe("middleware — refreshed auth cookies survive redirects", () => {
  it("carries the rotated token when redirecting a signed-in user off /login", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(new NextRequest("https://app.test/login"));

    // Redirect to /dashboard…
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    // …and the rotated cookie MUST ride along, otherwise the browser keeps
    // replaying the now-consumed refresh token and the session wedges until
    // the user manually clears cookies.
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("carries the rotated token when redirecting an unauth user to /login", async () => {
    mockUser = null;
    // Even on the logged-out path getUser() may emit cookie writes (e.g.
    // clearing a dead session); those must not be dropped on the redirect.
    refreshedCookies = [{ ...ROTATED, value: "cleared" }];

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    expect(res.cookies.get(ROTATED.name)?.value).toBe("cleared");
  });

  it("redirects a signed-in user with an invite token to /join/<token>", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(
      new NextRequest("https://app.test/login?invite=abc123"),
    );

    expect(res.headers.get("location")).toContain("/join/abc123");
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });

  it("passes through (no redirect) for a signed-in user on a protected page", async () => {
    mockUser = { id: "user-1" };
    refreshedCookies = [ROTATED];

    const res = await middleware(new NextRequest("https://app.test/dashboard"));

    // No redirect — the normal NextResponse.next() already carries cookies.
    expect(res.headers.get("location")).toBeNull();
    expect(res.cookies.get(ROTATED.name)?.value).toBe(ROTATED.value);
  });
});

// platform-admin-profiles tasks.md 5.1/5.2 — an operator's sign-in
// landings and /admin* itself route on the resolver, not on any
// client-account role.
describe("middleware — platform operator routing", () => {
  it("sends a seeded operator from / to /admin instead of /dashboard", async () => {
    process.env.PLATFORM_ADMINS = "ops@effect.dev";
    mockUser = { id: "op-1", email: "ops@effect.dev" };

    const res = await middleware(new NextRequest("https://app.test/"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("still sends an ordinary client from / to /dashboard", async () => {
    mockUser = { id: "user-1", email: "client@effect.dev" };
    mockOperatorRow = null;

    const res = await middleware(new NextRequest("https://app.test/"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("sends a signed-in operator from /login to /admin", async () => {
    mockUser = { id: "op-1", email: "ops@effect.dev" };
    mockOperatorRow = { role: "admin" };

    const res = await middleware(new NextRequest("https://app.test/login"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("lets a recorded admin-role operator reach /admin", async () => {
    mockUser = { id: "op-1", email: "admin@effect.dev" };
    mockOperatorRow = { role: "admin" };

    const res = await middleware(new NextRequest("https://app.test/admin"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("bounces a non-operator away from /admin to /dashboard", async () => {
    mockUser = { id: "user-1", email: "client@effect.dev" };
    mockOperatorRow = null;

    const res = await middleware(new NextRequest("https://app.test/admin"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });

  it("bounces an admin-role operator from /admin/operators to /admin", async () => {
    mockUser = { id: "op-1", email: "admin@effect.dev" };
    mockOperatorRow = { role: "admin" };

    const res = await middleware(new NextRequest("https://app.test/admin/operators"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/admin");
  });

  it("lets a manager reach /admin/operators", async () => {
    mockUser = { id: "mgr-1", email: "mgr@effect.dev" };
    mockOperatorRow = { role: "manager" };

    const res = await middleware(new NextRequest("https://app.test/admin/operators"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("bounces a non-operator away from /admin/operators to /dashboard", async () => {
    mockUser = { id: "user-1", email: "client@effect.dev" };
    mockOperatorRow = null;

    const res = await middleware(new NextRequest("https://app.test/admin/operators"));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/dashboard");
  });
});
