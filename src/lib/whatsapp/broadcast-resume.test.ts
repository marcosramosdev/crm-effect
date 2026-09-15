import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BroadcastError } from "./broadcast-core";
import {
  claimBroadcastDelivery,
  planBroadcastResume,
  releaseBroadcastDelivery,
  RESUME_MAX_PER_REQUEST,
} from "./broadcast-resume";

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => `decrypted:${v}`,
}));
// broadcast-resume.ts never calls this — it's only here to stop this
// test from pulling in `./broadcast-core`'s real `@/lib/api/v1/contacts`
// import (and its own transitive automations-engine chain) just to
// resolve one type-only `BroadcastError` import.
vi.mock("@/lib/api/v1/contacts", () => ({
  findOrCreateContact: vi.fn(),
}));

// ============================================================
// Claim / release — the mutex that stops a double-send.
// ============================================================

interface ClaimCall {
  update: Record<string, unknown>;
  filters: Record<string, unknown>;
  or?: string;
}

function claimDb(returnedRows: unknown[], calls: ClaimCall[]): SupabaseClient {
  return {
    from() {
      const call: ClaimCall = { update: {}, filters: {} };
      const b: Record<string, unknown> = {
        update: (row: Record<string, unknown>) => {
          call.update = row;
          calls.push(call);
          return b;
        },
        eq: (col: string, val: unknown) => {
          call.filters[col] = val;
          return b;
        },
        or: (expr: string) => {
          call.or = expr;
          return b;
        },
        select: async () => ({ data: returnedRows, error: null }),
        then: (resolve: (r: { error: null }) => unknown) =>
          resolve({ error: null }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("claimBroadcastDelivery", () => {
  it("claims when the conditional UPDATE matched a row", async () => {
    const calls: ClaimCall[] = [];
    const ok = await claimBroadcastDelivery(
      claimDb([{ id: "bc-1" }], calls),
      "acct-1",
      "bc-1",
      new Date("2026-08-11T12:00:00Z"),
    );

    expect(ok).toBe(true);
    expect(calls[0].filters).toEqual({ id: "bc-1", account_id: "acct-1" });
    expect(calls[0].update.delivery_locked_at).toBe("2026-08-11T12:00:00.000Z");
  });

  it("refuses when another pass already holds the lock", async () => {
    // The UPDATE's WHERE didn't match — someone else got there first.
    const ok = await claimBroadcastDelivery(claimDb([], []), "acct-1", "bc-1");
    expect(ok).toBe(false);
  });

  it("treats a lock older than the staleness window as abandoned", async () => {
    const calls: ClaimCall[] = [];
    await claimBroadcastDelivery(
      claimDb([{ id: "bc-1" }], calls),
      "acct-1",
      "bc-1",
      new Date("2026-08-11T12:00:00Z"),
    );
    // 30 minutes before "now" — a pass whose process died is recoverable
    // without touching the database by hand.
    expect(calls[0].or).toBe(
      "delivery_locked_at.is.null,delivery_locked_at.lt.2026-08-11T11:30:00.000Z",
    );
  });

  it("is scoped to the account, so another tenant cannot claim it", async () => {
    const calls: ClaimCall[] = [];
    await claimBroadcastDelivery(claimDb([], calls), "acct-9", "bc-1");
    expect(calls[0].filters.account_id).toBe("acct-9");
  });
});

describe("releaseBroadcastDelivery", () => {
  it("clears the lock", async () => {
    const calls: ClaimCall[] = [];
    await releaseBroadcastDelivery(claimDb([], calls), "bc-1");
    expect(calls[0].update).toEqual({ delivery_locked_at: null });
    expect(calls[0].filters).toEqual({ id: "bc-1" });
  });
});

// ============================================================
// Planning — which recipients a pass picks up, and with what frozen
// variable values.
// ============================================================

interface PlanFixture {
  broadcast?: Record<string, unknown> | null;
  recipients?: Record<string, unknown>[];
  config?: Record<string, unknown> | null;
}

interface PlanWrites {
  statusFilter?: unknown;
  failedIds?: unknown;
  failedUpdate?: Record<string, unknown>;
}

function planDb(fx: PlanFixture, writes: PlanWrites = {}): SupabaseClient {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        order: () => b,
        in: (col: string, vals: unknown) => {
          if (col === "status") writes.statusFilter = vals;
          if (col === "id") writes.failedIds = vals;
          return b;
        },
        update: (row: Record<string, unknown>) => {
          writes.failedUpdate = row;
          return b;
        },
        maybeSingle: async () => ({
          data: fx.broadcast === undefined ? null : fx.broadcast,
          error: null,
        }),
        single: async () => ({
          data: fx.config === undefined ? null : fx.config,
          error: null,
        }),
        then: (resolve: (r: { data: unknown[]; error: null }) => unknown) => {
          if (table === "broadcast_recipients") {
            return resolve({ data: fx.recipients ?? [], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const BROADCAST = {
  id: "bc-1",
  message_body: "Hi {{name}}, your order {{order_id}} ships on {{ship_date}}",
  media_url: null,
  media_kind: null,
  media_filename: null,
};

const CONFIG = { instance_token: "tok" };

function recipient(
  id: string,
  phone: string | null,
  values: unknown = { order_id: "A123" },
) {
  return {
    id,
    template_params: values,
    contact: phone ? { phone } : null,
  };
}

describe("planBroadcastResume", () => {
  it("plans the outstanding recipients with their frozen variable values", async () => {
    const writes: PlanWrites = {};
    const { plan, remaining, unsendable } = await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [
            recipient("r1", "+15551234567", {
              order_id: "A123",
              ship_date: "Friday",
            }),
            recipient("r2", "+15559876543", {
              order_id: "B456",
              ship_date: "Monday",
            }),
          ],
        },
        writes,
      ),
      "acct-1",
      "bc-1",
      "pending",
    );

    expect(writes.statusFilter).toEqual(["pending"]);
    // Phones are stored sanitized (no leading '+'), same as the shape
    // createBroadcast plans — deliverBroadcast feeds them to
    // phoneVariants from here.
    expect(plan.planned).toEqual([
      {
        recipientRowId: "r1",
        phone: "15551234567",
        values: { order_id: "A123", ship_date: "Friday" },
      },
      {
        recipientRowId: "r2",
        phone: "15559876543",
        values: { order_id: "B456", ship_date: "Monday" },
      },
    ]);
    expect(plan.instanceToken).toBe("decrypted:tok");
    expect(plan.messageBody).toBe(BROADCAST.message_body);
    expect(remaining).toBe(0);
    expect(unsendable).toBe(0);
  });

  it('scopes to failed rows when retrying, and to both for "all"', async () => {
    const failedWrites: PlanWrites = {};
    await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [recipient("r1", "+15551234567")],
        },
        failedWrites,
      ),
      "acct-1",
      "bc-1",
      "failed",
    );
    expect(failedWrites.statusFilter).toEqual(["failed"]);

    const allWrites: PlanWrites = {};
    await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [recipient("r1", "+15551234567")],
        },
        allWrites,
      ),
      "acct-1",
      "bc-1",
      "all",
    );
    expect(allWrites.statusFilter).toEqual(["pending", "failed"]);
  });

  it("treats a missing or malformed frozen-values column as no variables", async () => {
    const { plan } = await planBroadcastResume(
      planDb({
        broadcast: BROADCAST,
        config: CONFIG,
        recipients: [
          // Rows created before migration 040 carry a positional array;
          // a NULL is also possible.
          recipient("r1", "+15551234567", null),
          recipient("r2", "+15559876543", ["A123", "Friday"]),
        ],
      }),
      "acct-1",
      "bc-1",
      "pending",
    );
    expect(plan.planned.map((p) => p.values)).toEqual([{}, {}]);
  });

  it("fails unsendable rows up front so they stop blocking the status", async () => {
    const writes: PlanWrites = {};
    const { plan, unsendable } = await planBroadcastResume(
      planDb(
        {
          broadcast: BROADCAST,
          config: CONFIG,
          recipients: [
            recipient("r1", "+15551234567"),
            recipient("r2", null),
            recipient("r3", "nonsense"),
          ],
        },
        writes,
      ),
      "acct-1",
      "bc-1",
      "pending",
    );

    // Left 'pending', these would keep the broadcast in 'sending'
    // forever — the exact symptom being fixed.
    expect(unsendable).toBe(2);
    expect(writes.failedIds).toEqual(["r2", "r3"]);
    expect(writes.failedUpdate?.status).toBe("failed");
    expect(plan.planned).toHaveLength(1);
  });

  it("caps one pass and reports the leftover", async () => {
    const many = Array.from({ length: RESUME_MAX_PER_REQUEST + 25 }, (_, i) =>
      recipient(`r${i}`, "+1555000" + String(i).padStart(4, "0")),
    );
    const { plan, remaining } = await planBroadcastResume(
      planDb({ broadcast: BROADCAST, config: CONFIG, recipients: many }),
      "acct-1",
      "bc-1",
      "pending",
    );
    expect(plan.planned).toHaveLength(RESUME_MAX_PER_REQUEST);
    // Surfaced to the caller rather than silently dropped.
    expect(remaining).toBe(25);
  });

  it("404s a broadcast that is not on this account", async () => {
    await expect(
      planBroadcastResume(
        planDb({ broadcast: null }),
        "acct-1",
        "bc-1",
        "pending",
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("refuses when there is nothing outstanding", async () => {
    await expect(
      planBroadcastResume(
        planDb({ broadcast: BROADCAST, config: CONFIG, recipients: [] }),
        "acct-1",
        "bc-1",
        "failed",
      ),
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it("carries the media reference through to the plan", async () => {
    const { plan } = await planBroadcastResume(
      planDb({
        broadcast: {
          ...BROADCAST,
          media_url: "https://example.com/chat-media/f.jpg",
          media_kind: "image",
          media_filename: null,
        },
        config: CONFIG,
        recipients: [recipient("r1", "+15551234567")],
      }),
      "acct-1",
      "bc-1",
      "pending",
    );
    expect(plan.mediaUrl).toBe("https://example.com/chat-media/f.jpg");
    expect(plan.mediaKind).toBe("image");
  });
});
