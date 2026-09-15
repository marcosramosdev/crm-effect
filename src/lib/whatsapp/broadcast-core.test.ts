import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBroadcast,
  deliverBroadcast,
  finalizeBroadcastStatus,
  BroadcastError,
  type BroadcastPlan,
} from "./broadcast-core";
import { UazapiError } from "./uazapi-client";

// Contact resolution and token decryption are exercised elsewhere — stub
// them so these tests focus on the persistence + resolution boundary.
vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => `decrypted:${v}`,
}));
vi.mock("@/lib/api/v1/contacts", () => ({
  findOrCreateContact: vi.fn(async () => ({ id: "c1" })),
}));

const sendTextMessage = vi.fn();
const sendMediaMessage = vi.fn();
const fetchMediaAsBase64 = vi.fn();
vi.mock("./uazapi", async () => {
  const actual = await vi.importActual<typeof import("./uazapi")>("./uazapi");
  return {
    ...actual,
    sendTextMessage: (...args: unknown[]) => sendTextMessage(...args),
    sendMediaMessage: (...args: unknown[]) => sendMediaMessage(...args),
    fetchMediaAsBase64: (...args: unknown[]) => fetchMediaAsBase64(...args),
  };
});

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe("createBroadcast validation", () => {
  it("rejects a missing message_body with no attachment", async () => {
    await expect(
      createBroadcast(db, "acc", "user", {
        messageBody: "",
        recipients: [{ to: "+14155550123" }],
      }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("rejects media_url without media_kind", async () => {
    await expect(
      createBroadcast(db, "acc", "user", {
        messageBody: "",
        mediaUrl: "https://example.com/file.jpg",
        recipients: [{ to: "+14155550123" }],
      }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("rejects an empty recipient list", async () => {
    await expect(
      createBroadcast(db, "acc", "user", {
        messageBody: "hi",
        recipients: [],
      }),
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it("rejects more than 1000 recipients", async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: "+14155550123",
    }));
    await expect(
      createBroadcast(db, "acc", "user", { messageBody: "hi", recipients }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// Build a Supabase-shaped mock that gets createBroadcast past its config
// lookup and into persistence. `rpcResult` is what the atomic
// create_broadcast_with_recipients RPC returns.
function makeDb(
  rpcResult: { data: unknown; error: unknown },
  opts: {
    contacts?: Record<string, unknown>[];
    customFields?: Record<string, unknown>[];
    customValues?: Record<string, unknown>[];
  } = {},
) {
  const calls = {
    rpc: [] as { name: string; args: unknown }[],
    recipientUpdates: [] as { update: Record<string, unknown>; ids: unknown }[],
    usedDirectInsert: 0,
  };
  const database = {
    from(table: string) {
      if (table === "whatsapp_config") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    instance_token: "enc",
                    connection_state: "connected",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "contacts") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({ data: opts.contacts ?? [], error: null }),
          }),
        };
      }
      if (table === "custom_fields") {
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ data: opts.customFields ?? [], error: null }),
          }),
        };
      }
      if (table === "contact_custom_values") {
        return {
          select: () => ({
            in: () =>
              Promise.resolve({ data: opts.customValues ?? [], error: null }),
          }),
        };
      }
      if (table === "broadcasts" || table === "broadcast_recipients") {
        calls.usedDirectInsert++;
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: "orphan" }, error: null }),
            }),
          }),
          update: (row: Record<string, unknown>) => ({
            in: (_col: string, ids: unknown) => {
              calls.recipientUpdates.push({ update: row, ids });
              return Promise.resolve({ error: null });
            },
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    rpc(name: string, args: unknown) {
      calls.rpc.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  } as unknown as SupabaseClient;
  return { db: database, calls };
}

describe("createBroadcast atomicity (#370)", () => {
  it("creates parent + recipients through the atomic RPC, never a bare parent insert", async () => {
    const { db, calls } = makeDb({
      data: [{ broadcast_id: "b-1", recipient_id: "r-1", contact_id: "c1" }],
      error: null,
    });

    const plan = await createBroadcast(db, "acc", "user", {
      messageBody: "Hi there",
      recipients: [{ to: "+14155550123" }],
    });

    expect(calls.rpc).toHaveLength(1);
    expect(calls.rpc[0].name).toBe("create_broadcast_with_recipients");
    expect(calls.usedDirectInsert).toBe(0);
    expect(plan.broadcastId).toBe("b-1");
    expect(plan.planned).toEqual([
      { recipientRowId: "r-1", phone: "14155550123", values: {} },
    ]);
    // No placeholders in the body — no extra contact/custom-field reads.
    expect(calls.recipientUpdates).toHaveLength(0);
  });

  it("throws and leaves no orphaned parent when the atomic create fails", async () => {
    const { db, calls } = makeDb({
      data: null,
      error: { message: "recipient insert failed" },
    });

    await expect(
      createBroadcast(db, "acc", "user", {
        messageBody: "Hi there",
        recipients: [{ to: "+14155550123" }],
      }),
    ).rejects.toBeInstanceOf(BroadcastError);

    expect(calls.rpc).toHaveLength(1);
    expect(calls.usedDirectInsert).toBe(0);
  });
});

describe("createBroadcast variable resolution", () => {
  it("resolves a {{field}} placeholder from the contact row", async () => {
    const { db, calls } = makeDb(
      {
        data: [{ broadcast_id: "b-1", recipient_id: "r-1", contact_id: "c1" }],
        error: null,
      },
      { contacts: [{ id: "c1", name: "Jane Doe" }] },
    );

    const plan = await createBroadcast(db, "acc", "user", {
      messageBody: "Hi {{name}}!",
      recipients: [{ to: "+14155550123" }],
    });

    expect(calls.rpc[0].args).toMatchObject({
      p_variable_values: [{ name: "Jane Doe" }],
    });
    expect(plan.planned[0].values).toEqual({ name: "Jane Doe" });
  });

  it("resolves a custom-field placeholder by field_name", async () => {
    const { db } = makeDb(
      {
        data: [{ broadcast_id: "b-1", recipient_id: "r-1", contact_id: "c1" }],
        error: null,
      },
      {
        contacts: [{ id: "c1", name: "Jane" }],
        customFields: [{ id: "f1", field_name: "Deal Size" }],
        customValues: [
          { contact_id: "c1", custom_field_id: "f1", value: "$500" },
        ],
      },
    );

    const plan = await createBroadcast(db, "acc", "user", {
      messageBody: "Your deal: {{Deal Size}}",
      recipients: [{ to: "+14155550123" }],
    });

    expect(plan.planned[0].values).toEqual({ "Deal Size": "$500" });
  });

  it("applies a variable_defaults fallback when the contact has no value", async () => {
    const { db } = makeDb(
      {
        data: [{ broadcast_id: "b-1", recipient_id: "r-1", contact_id: "c1" }],
        error: null,
      },
      { contacts: [{ id: "c1", company: null }] },
    );

    const plan = await createBroadcast(db, "acc", "user", {
      messageBody: "Hi {{company}}!",
      variableDefaults: { company: "valued customer" },
      recipients: [{ to: "+14155550123" }],
    });

    expect(plan.planned[0].values).toEqual({ company: "valued customer" });
  });

  it("marks a recipient failed (not sent) when a variable has no value and no fallback", async () => {
    const { db, calls } = makeDb(
      {
        data: [{ broadcast_id: "b-1", recipient_id: "r-1", contact_id: "c1" }],
        error: null,
      },
      { contacts: [{ id: "c1", company: null }] },
    );

    const plan = await createBroadcast(db, "acc", "user", {
      messageBody: "Hi {{company}}!",
      recipients: [{ to: "+14155550123" }],
    });

    // Never enters the send loop...
    expect(plan.planned).toHaveLength(0);
    // ...but was flipped to 'failed' with a message naming the variable.
    expect(calls.recipientUpdates).toHaveLength(1);
    expect(calls.recipientUpdates[0].update.status).toBe("failed");
    expect(calls.recipientUpdates[0].update.error_message).toContain("company");
    expect(calls.recipientUpdates[0].ids).toEqual(["r-1"]);
  });
});

// ============================================================
// Terminal status (#472). Derived from the recipient rows, not from a
// counter local to one delivery pass.
// ============================================================

function statusDb(
  counts: Record<string, number>,
  total: number,
  writes: { update?: Record<string, unknown> },
) {
  return {
    from(table: string) {
      let status: string | null = null;
      const b: Record<string, unknown> = {
        select: () => b,
        eq: (col: string, val: unknown) => {
          if (col === "status") status = val as string;
          return b;
        },
        update: (row: Record<string, unknown>) => {
          if (table === "broadcasts") writes.update = row;
          return b;
        },
        then: (resolve: (r: { count: number; error: null }) => unknown) =>
          resolve({
            count: status === null ? total : (counts[status] ?? 0),
            error: null,
          }),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("finalizeBroadcastStatus", () => {
  it('leaves a capped pass in "sending" while recipients are still pending', async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 25 }, 1025, writes),
      "b-1",
    );
    expect(writes.update).toBeUndefined();
  });

  it("marks a fully-failed broadcast failed", async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 10 }, 10, writes),
      "b-1",
    );
    expect(writes.update?.status).toBe("failed");
  });

  it("marks a partially-failed broadcast sent", async () => {
    const writes: { update?: Record<string, unknown> } = {};
    await finalizeBroadcastStatus(
      statusDb({ pending: 0, failed: 3 }, 10, writes),
      "b-1",
    );
    expect(writes.update?.status).toBe("sent");
  });
});

// ============================================================
// deliverBroadcast — rate-limit back-off + disconnected-instance stop
// (7.3).
// ============================================================

interface DeliverDbOptions {
  connectionState?: string;
  recipients?: number;
}

function deliverDb(opts: DeliverDbOptions = {}) {
  const recipientWrites: { id: string; update: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      if (table === "whatsapp_config") {
        return {
          select: () => ({
            eq: () => ({
              single: () =>
                Promise.resolve({
                  data: {
                    connection_state: opts.connectionState ?? "connected",
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (table === "broadcast_recipients") {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          update: (row: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => {
              recipientWrites.push({ id, update: row });
              return Promise.resolve({ error: null });
            },
          }),
          then: (resolve: (r: { count: number; error: null }) => unknown) =>
            resolve({ count: 0, error: null }),
        };
        return b;
      }
      if (table === "broadcasts") {
        return {
          select: () => ({
            eq: () => ({
              then: (r: (v: unknown) => unknown) =>
                r({ count: opts.recipients ?? 1 }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  } as unknown as SupabaseClient;
  return { db, recipientWrites };
}

function makePlan(overrides: Partial<BroadcastPlan> = {}): BroadcastPlan {
  return {
    broadcastId: "b-1",
    accountId: "acc-1",
    messageBody: "Hi {{name}}",
    mediaUrl: null,
    mediaKind: null,
    mediaFilename: null,
    instanceToken: "tok",
    planned: [
      { recipientRowId: "r-1", phone: "15551234567", values: { name: "Jane" } },
    ],
    rejected: 0,
    ...overrides,
  };
}

describe("deliverBroadcast", () => {
  it("retries a rate-limited send and marks it sent once it clears", async () => {
    sendTextMessage
      .mockRejectedValueOnce(new UazapiError("rate_limited", "slow down", 429))
      .mockResolvedValueOnce({ messageId: "wamid-1" });

    const { db, recipientWrites } = deliverDb();
    await deliverBroadcast(db, makePlan());

    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    const sentWrite = recipientWrites.find((w) => w.update.status === "sent");
    expect(sentWrite?.update.whatsapp_message_id).toBe("wamid-1");
  });

  it("leaves the recipient pending (not failed) when rate limiting never clears", async () => {
    sendTextMessage.mockRejectedValue(
      new UazapiError("rate_limited", "slow down", 429),
    );

    const { db, recipientWrites } = deliverDb();
    await deliverBroadcast(db, makePlan());

    // No 'sent' or 'failed' write for the recipient — it was left as-is.
    const recipientStatusWrites = recipientWrites.filter((w) => w.id === "r-1");
    expect(recipientStatusWrites).toHaveLength(0);
  });

  it("does not attempt any send when the instance is disconnected", async () => {
    const { db, recipientWrites } = deliverDb({
      connectionState: "disconnected",
    });
    await deliverBroadcast(db, makePlan());

    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(recipientWrites.filter((w) => w.id === "r-1")).toHaveLength(0);
  });

  it("marks an ordinary send failure failed and continues to the next recipient", async () => {
    sendTextMessage
      .mockRejectedValueOnce(
        new UazapiError("invalid_request", "bad request", 400),
      )
      .mockResolvedValueOnce({ messageId: "wamid-2" });

    const { db, recipientWrites } = deliverDb();
    await deliverBroadcast(
      db,
      makePlan({
        planned: [
          { recipientRowId: "r-1", phone: "15551234567", values: {} },
          { recipientRowId: "r-2", phone: "15559876543", values: {} },
        ],
      }),
    );

    const r1 = recipientWrites.find((w) => w.id === "r-1");
    const r2 = recipientWrites.find((w) => w.id === "r-2");
    expect(r1?.update.status).toBe("failed");
    expect(r2?.update.status).toBe("sent");
  });
});
