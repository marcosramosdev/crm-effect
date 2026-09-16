import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { expireFollowups, isFollowupDue, materializeFollowups } from "./materialize";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("materialize.ts does not import from src/lib/whatsapp/", () => {
  it("has no import path under @/lib/whatsapp or ../whatsapp", () => {
    const src = readFileSync(path.join(__dirname, "materialize.ts"), "utf8");
    const importLines = src
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line));
    for (const line of importLines) {
      expect(line).not.toMatch(/lib\/whatsapp/);
    }
  });
});

describe("isFollowupDue", () => {
  const DEAL = {
    scheduled_at: "2026-06-10T12:00:00.000Z",
    archived_at: null,
    status: "open",
  };

  it("is due at each of the three default offsets (5d, 1d, 2h)", () => {
    // 5 days before.
    expect(
      isFollowupDue(DEAL, 7200, new Date("2026-06-05T12:00:00.000Z")),
    ).toBe(true);
    // 1 day before.
    expect(
      isFollowupDue(DEAL, 1440, new Date("2026-06-09T12:00:00.000Z")),
    ).toBe(true);
    // 2 hours before.
    expect(
      isFollowupDue(DEAL, 120, new Date("2026-06-10T10:00:00.000Z")),
    ).toBe(true);
  });

  it("is not due before the offset's moment", () => {
    expect(
      isFollowupDue(DEAL, 120, new Date("2026-06-10T09:00:00.000Z")),
    ).toBe(false);
  });

  it("is false for a deal with no scheduled_at", () => {
    expect(
      isFollowupDue(
        { ...DEAL, scheduled_at: null },
        120,
        new Date("2026-06-10T10:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("is false once the appointment itself has passed", () => {
    expect(
      isFollowupDue(DEAL, 120, new Date("2026-06-10T12:00:00.001Z")),
    ).toBe(false);
  });

  it("is false for an archived deal", () => {
    expect(
      isFollowupDue(
        { ...DEAL, archived_at: "2026-06-01T00:00:00.000Z" },
        120,
        new Date("2026-06-10T10:00:00.000Z"),
      ),
    ).toBe(false);
  });

  it("is false for a lost deal", () => {
    expect(
      isFollowupDue(
        { ...DEAL, status: "lost" },
        120,
        new Date("2026-06-10T10:00:00.000Z"),
      ),
    ).toBe(false);
  });
});

// ------------------------------------------------------------
// DB orchestration — a minimal chainable fake per table.
// ------------------------------------------------------------
interface MaterializeFakeState {
  accounts: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  insertedIds: { id: string }[];
  upsertCalls: { rows: unknown; options: unknown }[];
}

function fakeDb(state: MaterializeFakeState) {
  return {
    from(table: string) {
      if (table === "accounts") {
        return { select: () => Promise.resolve({ data: state.accounts, error: null }) };
      }
      if (table === "deals") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          not: () => chain,
          is: () => chain,
          neq: () => Promise.resolve({ data: state.deals, error: null }),
        };
        return chain;
      }
      if (table === "followup_messages") {
        return {
          upsert: (rows: unknown, options: unknown) => {
            state.upsertCalls.push({ rows, options });
            return {
              select: () => Promise.resolve({ data: state.insertedIds, error: null }),
            };
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("materializeFollowups", () => {
  const account = {
    id: "acct-1",
    followup_offsets: [7200, 1440, 120],
    followup_reminder_template: "Olá {nome}! {data} {hora}",
    timezone: "America/Sao_Paulo",
  };
  const deal = {
    id: "deal-1",
    conversation_id: "conv-1",
    scheduled_at: "2026-06-10T12:00:00.000Z",
    archived_at: null,
    status: "open",
    contact: { name: "Ana" },
    custom_values: [],
  };

  it("inserts exactly one pending row per due offset", async () => {
    const state: MaterializeFakeState = {
      accounts: [account],
      deals: [deal],
      insertedIds: [{ id: "fu-1" }],
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(
      db,
      new Date("2026-06-05T12:00:00.000Z"), // exactly the 5-day mark
    );
    expect(created).toBe(1);
    expect(state.upsertCalls).toHaveLength(1);
    const rows = state.upsertCalls[0].rows as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_id: "acct-1",
      deal_id: "deal-1",
      offset_minutes: 7200,
      status: "pending",
    });
    expect(state.upsertCalls[0].options).toMatchObject({
      onConflict: "deal_id,offset_minutes",
      ignoreDuplicates: true,
    });
  });

  it("a second run over the same due offset inserts nothing (idempotent)", async () => {
    // Simulates the DB already having the row: the ignore-duplicates
    // upsert returns zero inserted ids on the replay.
    const state: MaterializeFakeState = {
      accounts: [account],
      deals: [deal],
      insertedIds: [], // nothing newly inserted
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(
      db,
      new Date("2026-06-05T12:00:00.000Z"),
    );
    expect(created).toBe(0);
  });

  it("produces nothing for a deal with no scheduled_at", async () => {
    const state: MaterializeFakeState = {
      accounts: [account],
      deals: [{ ...deal, scheduled_at: null }],
      insertedIds: [],
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(db, new Date("2026-06-05T12:00:00.000Z"));
    expect(created).toBe(0);
    expect(state.upsertCalls).toHaveLength(0);
  });

  it("produces nothing for a past appointment", async () => {
    const state: MaterializeFakeState = {
      accounts: [account],
      deals: [deal],
      insertedIds: [],
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(
      db,
      new Date("2026-06-11T00:00:00.000Z"), // after the appointment
    );
    expect(created).toBe(0);
    expect(state.upsertCalls).toHaveLength(0);
  });

  it("produces nothing for an archived deal", async () => {
    const state: MaterializeFakeState = {
      accounts: [account],
      deals: [{ ...deal, archived_at: "2026-06-01T00:00:00.000Z" }],
      insertedIds: [],
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(db, new Date("2026-06-05T12:00:00.000Z"));
    expect(created).toBe(0);
  });

  it("produces nothing for a lost deal", async () => {
    const state: MaterializeFakeState = {
      accounts: [account],
      deals: [{ ...deal, status: "lost" }],
      insertedIds: [],
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(db, new Date("2026-06-05T12:00:00.000Z"));
    expect(created).toBe(0);
  });

  it("skips an account with zero configured offsets", async () => {
    const state: MaterializeFakeState = {
      accounts: [{ ...account, followup_offsets: [] }],
      deals: [deal],
      insertedIds: [],
      upsertCalls: [],
    };
    const db = fakeDb(state);
    const { created } = await materializeFollowups(db, new Date("2026-06-05T12:00:00.000Z"));
    expect(created).toBe(0);
    expect(state.upsertCalls).toHaveLength(0);
  });
});

interface ExpireFakeState {
  rows: { id: string; deal: { scheduled_at: string | null } | null }[];
  updatedIds: { id: string }[];
  updateCalls: { patch: unknown; ids: unknown }[];
}

describe("expireFollowups", () => {
  function fakeExpireDb(state: ExpireFakeState) {
    return {
      from(table: string) {
        if (table !== "followup_messages") throw new Error(`unexpected table: ${table}`);
        return {
          select: () => ({
            in: () => Promise.resolve({ data: state.rows, error: null }),
          }),
          update: (patch: unknown) => ({
            in: (_col: string, ids: unknown) => {
              state.updateCalls.push({ patch, ids });
              return {
                select: () => Promise.resolve({ data: state.updatedIds, error: null }),
              };
            },
          }),
        };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it("expires a pending row past its appointment", async () => {
    const state: ExpireFakeState = {
      rows: [{ id: "fu-1", deal: { scheduled_at: "2026-01-01T00:00:00.000Z" } }],
      updatedIds: [{ id: "fu-1" }],
      updateCalls: [],
    };
    const db = fakeExpireDb(state);
    const { expired } = await expireFollowups(db, new Date("2026-01-02T00:00:00.000Z"));
    expect(expired).toBe(1);
    expect(state.updateCalls[0].patch).toEqual({ status: "expired" });
    expect(state.updateCalls[0].ids).toEqual(["fu-1"]);
  });

  it("does not touch a row whose appointment is still ahead", async () => {
    const state: ExpireFakeState = {
      rows: [{ id: "fu-1", deal: { scheduled_at: "2026-06-01T00:00:00.000Z" } }],
      updatedIds: [],
      updateCalls: [],
    };
    const db = fakeExpireDb(state);
    const { expired } = await expireFollowups(db, new Date("2026-01-02T00:00:00.000Z"));
    expect(expired).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("only ever selects pending/approved rows — a sent row is untouched by construction", async () => {
    const state = {
      rows: [], // the select itself is scoped to status in (pending, approved)
      updatedIds: [],
      updateCalls: [],
    };
    const selectIn = vi.fn(() => Promise.resolve({ data: state.rows, error: null }));
    const db = {
      from: () => ({
        select: () => ({ in: selectIn }),
        update: () => ({ in: () => ({ select: () => Promise.resolve({ data: [], error: null }) }) }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expireFollowups(db, new Date());
    expect(selectIn).toHaveBeenCalledWith("status", ["pending", "approved"]);
  });
});
