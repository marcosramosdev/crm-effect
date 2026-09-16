import { describe, expect, it } from "vitest";
import { routeFollowupButtonReply } from "./webhook-routing";

interface FakeState {
  followup: { id: string; account_id: string; deal_id: string } | null;
  dealUpdates: { patch: unknown; filters: [string, unknown][] }[];
  followupUpdates: { patch: unknown; filters: [string, unknown][] }[];
  members: { user_id: string }[];
  notificationInserts: Record<string, unknown>[];
}

function fakeDb(state: FakeState) {
  return {
    from(table: string) {
      if (table === "followup_messages") {
        const filters: [string, unknown][] = [];
        let patch: Record<string, unknown> | null = null;
        const builder = {
          select: () => builder,
          update: (p: Record<string, unknown>) => {
            patch = p;
            return builder;
          },
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return builder;
          },
          maybeSingle: () => Promise.resolve({ data: state.followup, error: null }),
          then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) => {
            state.followupUpdates.push({ patch, filters });
            return Promise.resolve({ data: null, error: null }).then(onFulfilled);
          },
        };
        return builder;
      }
      if (table === "deals") {
        const filters: [string, unknown][] = [];
        let patch: Record<string, unknown> | null = null;
        const builder = {
          update: (p: Record<string, unknown>) => {
            patch = p;
            return builder;
          },
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return builder;
          },
          is: (c: string, v: unknown) => {
            filters.push([c, v]);
            return builder;
          },
          then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) => {
            state.dealUpdates.push({ patch, filters });
            return Promise.resolve({ data: null, error: null }).then(onFulfilled);
          },
        };
        return builder;
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              in: () => Promise.resolve({ data: state.members, error: null }),
            }),
          }),
        };
      }
      if (table === "notifications") {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            state.notificationInserts.push(...rows);
            return Promise.resolve({ data: null, error: null });
          },
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseState(): FakeState {
  return {
    followup: { id: "fu-1", account_id: "acct-1", deal_id: "deal-1" },
    dealUpdates: [],
    followupUpdates: [],
    members: [{ user_id: "user-1" }, { user_id: "user-2" }],
    notificationInserts: [],
  };
}

describe("routeFollowupButtonReply", () => {
  it("ignores a reply id that isn't a follow-up button", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await routeFollowupButtonReply(db, {
      accountId: "acct-1",
      conversationId: "conv-1",
      interactiveReplyId: "flow:step:next",
    });
    expect(state.dealUpdates).toHaveLength(0);
    expect(state.notificationInserts).toHaveLength(0);
  });

  it("ignores a null reply id (typed text, not a button press)", async () => {
    const state = baseState();
    const db = fakeDb(state);
    await routeFollowupButtonReply(db, {
      accountId: "acct-1",
      conversationId: "conv-1",
      interactiveReplyId: null,
    });
    expect(state.dealUpdates).toHaveLength(0);
  });

  it("ignores a follow-up belonging to another account", async () => {
    const state = baseState();
    state.followup = { id: "fu-1", account_id: "other-acct", deal_id: "deal-1" };
    const db = fakeDb(state);
    await routeFollowupButtonReply(db, {
      accountId: "acct-1",
      conversationId: "conv-1",
      interactiveReplyId: "fu:fu-1:confirm",
    });
    expect(state.dealUpdates).toHaveLength(0);
    expect(state.notificationInserts).toHaveLength(0);
  });

  describe("confirm", () => {
    it("stamps appointment_confirmed_at idempotently and flags remaining pending rows", async () => {
      const state = baseState();
      const db = fakeDb(state);
      await routeFollowupButtonReply(db, {
        accountId: "acct-1",
        conversationId: "conv-1",
        interactiveReplyId: "fu:fu-1:confirm",
      });

      expect(state.dealUpdates).toHaveLength(1);
      expect(state.dealUpdates[0].patch).toHaveProperty("appointment_confirmed_at");
      expect(state.dealUpdates[0].filters).toEqual(
        expect.arrayContaining([
          ["id", "deal-1"],
          ["appointment_confirmed_at", null],
        ]),
      );

      expect(state.followupUpdates).toHaveLength(1);
      expect(state.followupUpdates[0].patch).toEqual({ appointment_confirmed: true });
      expect(state.followupUpdates[0].filters).toEqual(
        expect.arrayContaining([
          ["deal_id", "deal-1"],
          ["status", "pending"],
        ]),
      );
      // Does not touch status — the remaining rows stay pending; a
      // human still decides whether to send them.
      expect(state.followupUpdates[0].patch).not.toHaveProperty("status");
    });

    it("does not raise a reschedule notification", async () => {
      const state = baseState();
      const db = fakeDb(state);
      await routeFollowupButtonReply(db, {
        accountId: "acct-1",
        conversationId: "conv-1",
        interactiveReplyId: "fu:fu-1:confirm",
      });
      expect(state.notificationInserts).toHaveLength(0);
    });
  });

  describe("reschedule", () => {
    it("notifies every agent+ member, carrying the conversation id, and touches no deal column", async () => {
      const state = baseState();
      const db = fakeDb(state);
      await routeFollowupButtonReply(db, {
        accountId: "acct-1",
        conversationId: "conv-1",
        interactiveReplyId: "fu:fu-1:reschedule",
      });

      expect(state.dealUpdates).toHaveLength(0);
      expect(state.notificationInserts).toHaveLength(2);
      for (const n of state.notificationInserts) {
        expect(n).toMatchObject({
          account_id: "acct-1",
          type: "followup_reschedule",
          conversation_id: "conv-1",
        });
      }
    });

    it("does not decide the remaining pending reminders", async () => {
      const state = baseState();
      const db = fakeDb(state);
      await routeFollowupButtonReply(db, {
        accountId: "acct-1",
        conversationId: "conv-1",
        interactiveReplyId: "fu:fu-1:reschedule",
      });
      expect(state.followupUpdates).toHaveLength(0);
    });
  });

  it("propagates a lookup failure to the caller (which wraps it)", async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: new Error("db down") }) }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    await expect(
      routeFollowupButtonReply(db, {
        accountId: "acct-1",
        conversationId: "conv-1",
        interactiveReplyId: "fu:fu-1:confirm",
      }),
    ).rejects.toThrow("db down");
  });
});
