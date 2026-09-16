import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  materializeFollowups: vi.fn(),
  expireFollowups: vi.fn(),
  state: {
    tickUpdates: [] as { patch: unknown }[],
  },
}));

vi.mock("@/lib/followups/materialize", () => ({
  materializeFollowups: h.materializeFollowups,
  expireFollowups: h.expireFollowups,
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table !== "followup_cron_state") throw new Error(`unexpected table ${table}`);
      return {
        update: (patch: unknown) => {
          h.state.tickUpdates.push({ patch });
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
  }),
}));

import { GET } from "./route";

const SECRET = "cron-secret-value";

function request(headers: Record<string, string> = {}) {
  return new Request("https://example.com/api/followups/cron", { headers });
}

beforeEach(() => {
  vi.stubEnv("AUTOMATION_CRON_SECRET", SECRET);
  h.state.tickUpdates = [];
  h.materializeFollowups.mockResolvedValue({ created: 3 });
  h.expireFollowups.mockResolvedValue({ expired: 1 });
});

describe("GET /api/followups/cron", () => {
  it("503s when the cron secret isn't configured", async () => {
    vi.stubEnv("AUTOMATION_CRON_SECRET", "");
    const res = await GET(request({ "x-cron-secret": SECRET }));
    expect(res.status).toBe(503);
    expect(h.state.tickUpdates).toHaveLength(0);
  });

  it("401s on a missing secret header", async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(h.state.tickUpdates).toHaveLength(0);
  });

  it("401s on a wrong secret of the same length", async () => {
    const wrong = "x".repeat(SECRET.length);
    const res = await GET(request({ "x-cron-secret": wrong }));
    expect(res.status).toBe(401);
    expect(h.state.tickUpdates).toHaveLength(0);
  });

  it("401s on a wrong-length secret", async () => {
    const res = await GET(request({ "x-cron-secret": "short" }));
    expect(res.status).toBe(401);
    expect(h.state.tickUpdates).toHaveLength(0);
  });

  it("on success: sends no message, reports both counts, and records the tick", async () => {
    const res = await GET(request({ "x-cron-secret": SECRET }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ created: 3, expired: 1 });
    expect(h.state.tickUpdates).toHaveLength(1);
    expect(h.state.tickUpdates[0].patch).toHaveProperty("last_tick_at");
  });

  it("does not record a tick on a 401", async () => {
    await GET(request({ "x-cron-secret": "wrong" }));
    expect(h.state.tickUpdates).toHaveLength(0);
  });
});
