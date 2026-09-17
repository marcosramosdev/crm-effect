import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashWebhookSecret } from "@/lib/whatsapp/instance";

const SECRET = "test-webhook-secret";
const WRONG_SECRET = "not-the-right-secret";
const EXPECTED_HASH = hashWebhookSecret(SECRET);

// Shared, hoisted state the module mocks close over. Reset per test.
const h = vi.hoisted(() => {
  const BASE_CONFIG = {
    id: "config-1",
    account_id: "acc-1",
    user_id: "user-1",
    instance_token: "enc:instance-token",
    connection_state: "connected",
    paired_phone: "15551230000",
    paired_at: "2026-01-01T00:00:00.000Z",
    mirror_inbound_media: true,
  };
  return {
    BASE_CONFIG,
    runAutomationsForTrigger: vi.fn(),
    routeFollowupButtonReply: vi.fn(),
    dispatchInboundToFlows: vi.fn(),
    dispatchInboundToAiReply: vi.fn(),
    dispatchWebhookEvent: vi.fn(),
    findExistingContact: vi.fn(),
    resolveInboundMedia: vi.fn(),
    state: {
      afterCallbacks: [] as (() => Promise<void> | void)[],
      config: BASE_CONFIG as Record<string, unknown> | null,
      // messages table
      messageUpsertResult: [{ id: "msg-1" }] as { id: string }[],
      upsertCalls: [] as { row: Record<string, unknown>; options: unknown }[],
      messageStatusUpdates: [] as Record<string, unknown>[],
      priorCustomerMsgCount: 0,
      replyContextParent: null as { id: string } | null,
      /** Rows returned by the status-update lookup (`messages_update`). */
      messageRows: [] as {
        id: string;
        status: string;
        conversation_id: string;
        conversations: { account_id: string } | null;
      }[],
      // conversations table
      conversation: {
        id: "conv-1",
        status: "open",
        account_id: "acc-1",
      } as Record<string, unknown> | null,
      conversationCreated: false,
      // contacts table
      contactInserts: [] as Record<string, unknown>[],
      contactUpdates: [] as Record<string, unknown>[],
      contactUpdateShouldError: false,
      // broadcast_recipients table
      recipient: null as { id: string; status: string } | null,
      recipientUpdates: [] as Record<string, unknown>[],
      // deals table (default-pipeline auto-seed)
      dealInserts: [] as Record<string, unknown>[],
      existingDealCount: 0,
      dealInsertShouldError: false,
      accountDefaultCurrency: "BRL" as string | null,
      // whatsapp_config table
      configUpdates: [] as Record<string, unknown>[],
      // message_reactions table
      reactionUpserts: [] as Record<string, unknown>[],
      reactionDeletes: 0,
      // rpc
      rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
    },
  };
});

vi.mock("next/server", () => ({
  after: (cb: () => Promise<void> | void) => {
    h.state.afterCallbacks.push(cb);
  },
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, init }),
  },
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      switch (table) {
        case "whatsapp_config":
          return {
            select: () => ({
              eq: (_col: string, val: string) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      h.state.config && val === EXPECTED_HASH
                        ? h.state.config
                        : null,
                    error: null,
                  }),
              }),
            }),
            update: (patch: Record<string, unknown>) => {
              h.state.configUpdates.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        case "contacts":
          return {
            insert: (row: Record<string, unknown>) => {
              h.state.contactInserts.push(row);
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: "contact-new", ...row },
                      error: null,
                    }),
                }),
              };
            },
            update: (patch: Record<string, unknown>) => {
              h.state.contactUpdates.push(patch);
              return {
                eq: () =>
                  Promise.resolve({
                    error: h.state.contactUpdateShouldError
                      ? { message: "contact update boom" }
                      : null,
                  }),
              };
            },
          };
        case "conversations":
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () =>
                      Promise.resolve({
                        data: h.state.conversation
                          ? [h.state.conversation]
                          : [],
                        error: null,
                      }),
                  }),
                }),
              }),
            }),
            insert: (row: Record<string, unknown>) => ({
              select: () => ({
                single: () => {
                  const created = { id: "conv-new", status: "open", ...row };
                  h.state.conversation = created;
                  h.state.conversationCreated = true;
                  return Promise.resolve({ data: created, error: null });
                },
              }),
            }),
          };
        case "broadcast_recipients":
          return {
            select: (cols: string) => {
              if (cols === "id, status") {
                // processStatusUpdate: select('id, status').eq(...).maybeSingle()
                return {
                  eq: () => ({
                    maybeSingle: () =>
                      Promise.resolve({ data: h.state.recipient, error: null }),
                  }),
                };
              }
              // flagBroadcastReplyIfAny
              return {
                eq: () => ({
                  eq: () => ({
                    in: () => ({
                      order: () => ({
                        limit: () => Promise.resolve({ data: [], error: null }),
                      }),
                    }),
                  }),
                }),
              };
            },
            update: (patch: Record<string, unknown>) => {
              h.state.recipientUpdates.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        case "messages":
          return {
            select: (cols: string, opts?: { head?: boolean }) => {
              if (opts?.head) {
                // priorCustomerMsgCount: select('id',{count,head}).eq().eq()
                return {
                  eq: () => ({
                    eq: () =>
                      Promise.resolve({
                        count: h.state.priorCustomerMsgCount,
                        error: null,
                      }),
                  }),
                };
              }
              if (cols === "id") {
                // lookupInternalIdByMessageId: select('id').eq().eq().maybeSingle()
                return {
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () =>
                        Promise.resolve({
                          data: h.state.replyContextParent,
                          error: null,
                        }),
                    }),
                  }),
                };
              }
              // processStatusUpdate: select('id, status, conversation_id, conversations(account_id)').eq().limit()
              return {
                eq: () => ({
                  limit: () =>
                    Promise.resolve({ data: h.state.messageRows, error: null }),
                }),
              };
            },
            upsert: (row: Record<string, unknown>, options: unknown) => {
              h.state.upsertCalls.push({ row, options });
              return {
                select: () =>
                  Promise.resolve({
                    data: h.state.messageUpsertResult,
                    error: null,
                  }),
              };
            },
            update: (patch: Record<string, unknown>) => {
              h.state.messageStatusUpdates.push(patch);
              return { eq: () => Promise.resolve({ error: null }) };
            },
          };
        case "deals":
          return {
            select: (_cols: string, opts?: { head?: boolean }) => ({
              eq: () =>
                opts?.head
                  ? Promise.resolve({
                      count: h.state.existingDealCount,
                      error: null,
                    })
                  : Promise.resolve({ data: [], error: null }),
            }),
            insert: (row: Record<string, unknown>) => {
              if (h.state.dealInsertShouldError) {
                return Promise.resolve({ error: { message: "insert boom" } });
              }
              h.state.dealInserts.push(row);
              return Promise.resolve({ error: null });
            },
          };
        case "accounts":
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      h.state.accountDefaultCurrency === null
                        ? null
                        : { default_currency: h.state.accountDefaultCurrency },
                    error: null,
                  }),
              }),
            }),
          };
        case "message_reactions":
          return {
            upsert: (row: Record<string, unknown>) => {
              h.state.reactionUpserts.push(row);
              return Promise.resolve({ error: null });
            },
            delete: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => {
                    h.state.reactionDeletes++;
                    return Promise.resolve({ error: null });
                  },
                }),
              }),
            }),
          };
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      h.state.rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    storage: {
      from() {
        throw new Error(
          "storage should not be touched — resolveInboundMedia is mocked",
        );
      },
    },
  }),
}));

vi.mock("@/lib/contacts/dedupe", () => ({
  findExistingContact: h.findExistingContact,
  isUniqueViolation: () => false,
}));

vi.mock("@/lib/whatsapp/inbound-media", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/inbound-media")>();
  return { ...actual, resolveInboundMedia: h.resolveInboundMedia };
});

vi.mock("@/lib/automations/engine", () => ({
  runAutomationsForTrigger: h.runAutomationsForTrigger,
}));
vi.mock("@/lib/followups/webhook-routing", () => ({
  routeFollowupButtonReply: h.routeFollowupButtonReply,
}));
vi.mock("@/lib/flows/engine", () => ({
  dispatchInboundToFlows: h.dispatchInboundToFlows,
}));
vi.mock("@/lib/ai/auto-reply", () => ({
  dispatchInboundToAiReply: h.dispatchInboundToAiReply,
}));
vi.mock("@/lib/webhooks/deliver", () => ({
  dispatchWebhookEvent: h.dispatchWebhookEvent,
}));

import { POST, normalizeWebhookEventType, parseCtwa } from "./route";

// The real UAZAPI callback envelope (see route.ts `extractEnvelope` /
// design.md D1): the event type is in `EventType`, and the payload sits
// under `message` for `messages`/`message` events, under `event` for
// everything else. `event` here is an OBJECT, not the type string.
function envelope(eventType: string, data: unknown) {
  const key =
    eventType === "messages" || eventType === "message" ? "message" : "event";
  return {
    EventType: eventType,
    instanceName: "inst-1",
    token: "tok-1",
    [key]: data,
  };
}

// The idealized `{ event: string, data }` shape from UAZAPI's OpenAPI
// `WebhookEvent` schema. The gateway was not observed sending this, but
// `extractEnvelope` still accepts it as a fallback.
function legacyEnvelope(event: string, data: unknown) {
  return { event, instance: "inst-1", data };
}

function fakeRequest(body: unknown) {
  return { text: async () => JSON.stringify(body) } as unknown as Request;
}

/** The mocked `NextResponse.json` return shape (see the `next/server` mock above) — distinct from the real type `POST` is declared against. */
type MockedResponse = { body: unknown; init?: { status?: number } };

async function callPost(body: unknown, secret: string) {
  const res = await POST(fakeRequest(body), {
    params: Promise.resolve({ secret }),
  });
  return res as unknown as MockedResponse;
}

async function runWebhook(body: unknown, secret = SECRET) {
  const res = await callPost(body, secret);
  for (const cb of h.state.afterCallbacks) await cb();
  return res;
}

const TEXT_MESSAGE = {
  messageid: "uaz-1",
  chatid: "15551230000@s.whatsapp.net",
  sender: "15551230000@s.whatsapp.net",
  senderName: "Ada",
  isGroup: false,
  fromMe: false,
  messageType: "text",
  messageTimestamp: 1700000000000,
  text: "hello",
};

// The `message` payload from a real captured `EventType: "messages"`
// delivery (UAZAPI 2026-08). Field names line up with the reads in
// `processMessage`; `messageType` arrives title-cased ("Conversation")
// and is lower-cased before the TEXT_MESSAGE_TYPES check.
const REAL_INBOUND_MESSAGE = {
  buttonOrListid: "",
  chatid: "553391276668@s.whatsapp.net",
  chatlid: "197847718838277@lid",
  content: "Como está ?",
  fromMe: false,
  id: "553391681812:3A3BA53D870916CDC3CC",
  isGroup: false,
  mediaType: "",
  messageTimestamp: 1787841706000,
  messageType: "Conversation",
  messageid: "3A3BA53D870916CDC3CC",
  owner: "553391681812",
  quoted: "",
  reaction: "",
  sender: "197847718838277@lid",
  senderName: "Marcos Ramos",
  sender_pn: "553391276668@s.whatsapp.net",
  status: "",
  text: "Como está ?",
  type: "text",
  wasSentByApi: false,
};

// Real captured `EventType: "messages"` payload from "Arthur Pena" —
// message.content carrying contextInfo.externalAdReply (design.md D10).
// Trimmed to the fields parseCtwa/processMessage read.
const REAL_CTWA_CONTENT = {
  title: "Dr Arthur Pena . Neurologista",
  previewType: 0,
  contextInfo: {
    conversionSource: "FB_Ads",
    conversionDelaySeconds: 3,
    externalAdReply: {
      title: "Dr Arthur Pena . Neurologista",
      body: "",
      mediaType: 2,
      mediaURL:
        "https://www.facebook.com/61587334015088/videos/1332056855401835/",
      sourceType: "ad",
      sourceID: "120250103171390297",
      sourceURL: "https://www.instagram.com/p/DcRR3t3Aivx/",
      containsAutoReply: false,
      ctwaClid:
        "AfgDVt9Jf9YD66CwnEiMzSPpO7CiJxc_jTPUy-G-CUSW5ftnlLagcyNQC9FI7UNCEoDEa5Wsf9ppFX_G0x6lN_Y6UiZavK_lccaI0BJZCbeTUczyR2utDicx1d58QKEyHeS0KgKYOw",
      clickToWhatsappCall: true,
      sourceApp: "instagram",
    },
    entryPointConversionSource: "ctwa_ad",
    entryPointConversionApp: "instagram",
  },
};
const REAL_CTWA_CTWA_CLID = REAL_CTWA_CONTENT.contextInfo.externalAdReply.ctwaClid;
const REAL_CTWA_SOURCE_ID = REAL_CTWA_CONTENT.contextInfo.externalAdReply.sourceID;

const CTWA_MESSAGE = {
  buttonOrListid: "",
  chatid: "553193611736@s.whatsapp.net",
  fromMe: false,
  isGroup: false,
  messageType: "ExtendedTextMessage",
  messageTimestamp: 1789529644000,
  messageid: "ACB3CC7379C7F556C2BE0B3CA91C28BA",
  quoted: "",
  reaction: "",
  senderName: "Ada",
  status: "",
  text: "Olá! Tenho interesse e queria mais informações, por favor.",
  content: REAL_CTWA_CONTENT,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});

  h.state.afterCallbacks = [];
  h.state.config = { ...h.BASE_CONFIG };
  h.state.messageUpsertResult = [{ id: "msg-1" }];
  h.state.upsertCalls = [];
  h.state.messageStatusUpdates = [];
  h.state.priorCustomerMsgCount = 0;
  h.state.replyContextParent = null;
  h.state.messageRows = [];
  h.state.conversation = { id: "conv-1", status: "open", account_id: "acc-1" };
  h.state.conversationCreated = false;
  h.state.contactInserts = [];
  h.state.contactUpdates = [];
  h.state.contactUpdateShouldError = false;
  h.state.recipient = null;
  h.state.recipientUpdates = [];
  h.state.configUpdates = [];
  h.state.reactionUpserts = [];
  h.state.reactionDeletes = 0;
  h.state.rpcCalls = [];
  h.state.dealInserts = [];
  h.state.existingDealCount = 0;
  h.state.dealInsertShouldError = false;
  h.state.accountDefaultCurrency = "BRL";

  h.findExistingContact.mockResolvedValue({
    id: "contact-1",
    name: "Ada",
    phone: "15551230000",
    ctwa_clid: null,
  });
  h.resolveInboundMedia.mockResolvedValue({ mediaUrl: null, mediaType: null });
  h.dispatchInboundToFlows.mockResolvedValue({ consumed: false });
  h.dispatchInboundToAiReply.mockResolvedValue(undefined);
  h.dispatchWebhookEvent.mockResolvedValue(undefined);
  h.runAutomationsForTrigger.mockResolvedValue(undefined);
  h.routeFollowupButtonReply.mockResolvedValue(undefined);
});

// ============================================================
// normalizeWebhookEventType — the alias map (design D1). UAZAPI's spec
// disagrees with itself on the delivered event name, so both spellings
// of each category must normalize to the same internal value.
// ============================================================
describe("normalizeWebhookEventType", () => {
  it.each([
    ["message", "inbound"],
    ["messages", "inbound"],
    ["messages_update", "status"],
    ["status", "status"],
    ["connection", "connection"],
    ["MESSAGES", "inbound"],
  ])("maps %j -> %j", (raw, expected) => {
    expect(normalizeWebhookEventType(raw)).toBe(expected);
  });

  it.each([["presence"], ["groups"], ["history"], ["call"], [""], [undefined]])(
    "returns null for the unhandled/empty value %j",
    (raw) => {
      expect(normalizeWebhookEventType(raw as string | undefined)).toBeNull();
    },
  );
});

// ============================================================
// 4.1 — secret validation
// ============================================================
describe("secret validation", () => {
  it("a valid secret is accepted and processes the event", async () => {
    const res = await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(res.init?.status ?? 200).toBe(200);
    expect(h.state.upsertCalls).toHaveLength(1);
  });

  it("a wrong secret is rejected with 401 and nothing is processed", async () => {
    const res = await runWebhook(
      envelope("message", TEXT_MESSAGE),
      WRONG_SECRET,
    );
    expect(res.init?.status).toBe(401);
    expect(h.state.afterCallbacks).toHaveLength(0);
    expect(h.state.upsertCalls).toHaveLength(0);
  });

  it("a missing secret is rejected with 401", async () => {
    const res = await runWebhook(envelope("message", TEXT_MESSAGE), "");
    expect(res.init?.status).toBe(401);
    expect(h.state.upsertCalls).toHaveLength(0);
  });
});

// ============================================================
// 4.3 — event envelope parsing and branching
// ============================================================
describe("event envelope", () => {
  it("acknowledges a malformed (non-JSON) body without persisting", async () => {
    const res = (await POST(
      { text: async () => "not json" } as unknown as Request,
      { params: Promise.resolve({ secret: SECRET }) },
    )) as unknown as MockedResponse;
    expect(res.init?.status ?? 200).toBe(200);
    expect(h.state.afterCallbacks).toHaveLength(0);
  });

  it("acknowledges a body missing event/data without persisting", async () => {
    const res = await runWebhook({ instance: "inst-1" });
    expect(res.init?.status ?? 200).toBe(200);
    expect(h.state.upsertCalls).toHaveLength(0);
  });

  it("acknowledges a well-formed envelope with an unhandled event type, logs it, and persists nothing", async () => {
    const res = await runWebhook(envelope("presence", { foo: "bar" }));
    expect(res.init?.status ?? 200).toBe(200);
    expect(h.state.upsertCalls).toHaveLength(0);
    expect(h.state.configUpdates).toHaveLength(0);
    expect(console.warn).toHaveBeenCalledWith(
      "[webhook] unhandled event type",
      expect.objectContaining({ eventType: "presence", dataKeys: ["foo"] }),
    );
  });

  it("ingests an inbound message delivered in the idealized `{ event, data }` fallback shape", async () => {
    await runWebhook(legacyEnvelope("messages", TEXT_MESSAGE));
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].row).toMatchObject({
      sender_type: "customer",
      content_text: "hello",
      message_id: "uaz-1",
    });
  });

  it("routes a `message` event to inbound ingestion", async () => {
    await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(h.state.upsertCalls).toHaveLength(1);
  });

  it("routes a `messages` (plural) event to inbound ingestion", async () => {
    await runWebhook(envelope("messages", TEXT_MESSAGE));
    expect(h.state.upsertCalls).toHaveLength(1);
  });

  it("routes a `messages_update` event to status handling", async () => {
    h.state.messageRows = [
      {
        id: "row-1",
        status: "sent",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];
    await runWebhook(
      envelope("messages_update", { messageid: "uaz-1", status: "Delivered" }),
    );
    expect(h.state.messageStatusUpdates).toEqual([{ status: "delivered" }]);
  });

  it("routes a `status` event to status handling (payload-enum spelling of `messages_update`)", async () => {
    h.state.messageRows = [
      {
        id: "row-1",
        status: "sent",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];
    await runWebhook(
      envelope("status", { messageid: "uaz-1", status: "Delivered" }),
    );
    expect(h.state.messageStatusUpdates).toEqual([{ status: "delivered" }]);
  });

  it("routes a `connection` event to connection-state handling", async () => {
    await runWebhook(
      envelope("connection", { instance: { status: "connecting" } }),
    );
    expect(h.state.configUpdates).toHaveLength(1);
    expect(h.state.configUpdates[0]).toMatchObject({
      connection_state: "connecting",
    });
  });
});

// ============================================================
// 4.4 — inbound message ingestion / contact resolution
// ============================================================
describe("contact resolution", () => {
  it("a known contact is matched, not recreated", async () => {
    await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(h.findExistingContact).toHaveBeenCalledWith(
      expect.anything(),
      "acc-1",
      "15551230000",
    );
    expect(h.state.contactInserts).toHaveLength(0);
  });

  it("an unknown number creates a new contact", async () => {
    h.findExistingContact.mockResolvedValueOnce(null);
    await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(h.state.contactInserts).toHaveLength(1);
    expect(h.state.contactInserts[0]).toMatchObject({
      account_id: "acc-1",
      phone: "15551230000",
      name: "Ada",
    });
  });

  it("strips the JID suffix before resolving the contact", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        chatid: "5511999999999@s.whatsapp.net",
      }),
    );
    expect(h.findExistingContact).toHaveBeenCalledWith(
      expect.anything(),
      "acc-1",
      "5511999999999",
    );
  });
});

// ============================================================
// Default inbound pipeline — auto-seed a deal for new contacts
// (whatsapp-messaging spec, "New inbound contacts join the configured
// default pipeline"; migration 041)
// ============================================================
describe("default inbound pipeline auto-seed", () => {
  const withDefault = () => {
    h.state.config = {
      ...h.BASE_CONFIG,
      inbound_default_pipeline_id: "pipe-1",
      inbound_default_stage_id: "stage-1",
    };
  };

  it("seeds one deal on the configured pipeline/stage for a newly-created contact", async () => {
    withDefault();
    h.findExistingContact.mockResolvedValueOnce(null);

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.dealInserts).toHaveLength(1);
    expect(h.state.dealInserts[0]).toMatchObject({
      account_id: "acc-1",
      user_id: "user-1",
      pipeline_id: "pipe-1",
      stage_id: "stage-1",
      contact_id: "contact-new",
      value: 0,
      status: "open",
      currency: "BRL",
    });
  });

  it("does not seed when no default pipeline is configured", async () => {
    h.findExistingContact.mockResolvedValueOnce(null);

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.dealInserts).toHaveLength(0);
  });

  it("does not seed for an already-existing contact", async () => {
    withDefault();
    // default beforeEach mock resolves an existing contact

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.dealInserts).toHaveLength(0);
  });

  it("does not seed when the contact already has a deal", async () => {
    withDefault();
    h.findExistingContact.mockResolvedValueOnce(null);
    h.state.existingDealCount = 2;

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.dealInserts).toHaveLength(0);
  });

  it("falls back to USD when the account currency is unavailable", async () => {
    withDefault();
    h.findExistingContact.mockResolvedValueOnce(null);
    h.state.accountDefaultCurrency = null;

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.dealInserts[0]).toMatchObject({ currency: "USD" });
  });

  it("a deal-insert failure does not break ingestion or downstream dispatch", async () => {
    withDefault();
    h.findExistingContact.mockResolvedValueOnce(null);
    h.state.dealInsertShouldError = true;

    await runWebhook(envelope("message", TEXT_MESSAGE));

    // Message still persisted…
    expect(h.state.upsertCalls).toHaveLength(1);
    // …and downstream dispatch still ran.
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1);
    expect(h.state.dealInserts).toHaveLength(0);
  });
});

// ============================================================
// 4.5 — group / channel / self-sent / duplicate drop at the boundary
// ============================================================
describe("ingest boundary drops", () => {
  it("drops a group (@g.us) event without creating anything", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        isGroup: true,
        chatid: "120363339858396166@g.us",
      }),
    );
    expect(h.findExistingContact).not.toHaveBeenCalled();
    expect(h.state.upsertCalls).toHaveLength(0);
  });

  it("drops a channel (@newsletter) event without creating anything", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        chatid: "120363123456789012@newsletter",
      }),
    );
    expect(h.findExistingContact).not.toHaveBeenCalled();
    expect(h.state.upsertCalls).toHaveLength(0);
  });

  it("drops a self-sent (fromMe) event without creating anything", async () => {
    await runWebhook(envelope("message", { ...TEXT_MESSAGE, fromMe: true }));
    expect(h.findExistingContact).not.toHaveBeenCalled();
    expect(h.state.upsertCalls).toHaveLength(0);
  });

  it("a repeated messageid is deduplicated: no downstream fan-out", async () => {
    h.state.messageUpsertResult = []; // ON CONFLICT DO NOTHING → empty select()
    await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.rpcCalls).toHaveLength(0);
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      "message.received",
      expect.anything(),
    );
  });
});

// ============================================================
// 4.6 — interactive (button/list) reply mapping
// ============================================================
describe("interactive replies", () => {
  it("maps buttonOrListid onto the flows-engine reply-payload shape", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-btn",
        buttonOrListid: "ORDER_STATUS",
        text: "Order status",
      }),
    );

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "interactive",
      content_text: "Order status",
      interactive_reply_id: "ORDER_STATUS",
    });
    expect(h.dispatchInboundToFlows).toHaveBeenCalledWith(
      expect.objectContaining({
        message: {
          kind: "interactive_reply",
          reply_id: "ORDER_STATUS",
          reply_title: "Order status",
          meta_message_id: "uaz-btn",
        },
      }),
    );
  });
});

// ============================================================
// Follow-up reminder button routing — design.md D9. The routing
// logic itself (confirm/reschedule branches, cross-account ignore) is
// unit-tested in src/lib/followups/webhook-routing.test.ts; these
// tests cover the webhook's OWN responsibilities: calling it with the
// right args, never letting it swallow the message or block other
// dispatch, and never letting a routing failure escape.
// ============================================================
describe("follow-up button routing (design.md D9)", () => {
  it("still fires interactive_reply automations for a reminder reply", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-fu-1",
        buttonOrListid: "fu:fu-1:confirm",
        text: "Confirmar",
      }),
    );

    expect(h.routeFollowupButtonReply).toHaveBeenCalledWith(
      expect.anything(),
      {
        accountId: "acc-1",
        conversationId: "conv-1",
        interactiveReplyId: "fu:fu-1:confirm",
      },
    );
    expect(h.runAutomationsForTrigger).toHaveBeenCalledWith(
      expect.objectContaining({ triggerType: "interactive_reply" }),
    );
  });

  it("is called with a null interactiveReplyId for typed text (no buttonOrListid) — not treated as a button press", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-typed",
        buttonOrListid: undefined,
        text: "Confirmar",
      }),
    );

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "text",
      interactive_reply_id: null,
    });
    expect(h.routeFollowupButtonReply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ interactiveReplyId: null }),
    );
  });

  it("a routing failure is logged and never propagates — the inbound message stays intact", async () => {
    h.routeFollowupButtonReply.mockRejectedValueOnce(new Error("boom"));
    const res = await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-fu-2",
        buttonOrListid: "fu:fu-2:confirm",
      }),
    );
    expect(res.init?.status ?? 200).toBe(200);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.dispatchInboundToFlows).toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).toHaveBeenCalled();
  });

  it("redelivery is exactly-once: routing runs only on the genuine first delivery", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-fu-3",
        buttonOrListid: "fu:fu-3:confirm",
      }),
    );
    expect(h.routeFollowupButtonReply).toHaveBeenCalledTimes(1);

    // Replay: the (conversation_id, message_id) unique index turns this
    // into ON CONFLICT DO NOTHING, so the handler never reaches the
    // routing call again.
    h.state.afterCallbacks = [];
    h.state.messageUpsertResult = [];
    h.routeFollowupButtonReply.mockClear();

    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-fu-3",
        buttonOrListid: "fu:fu-3:confirm",
      }),
    );
    expect(h.routeFollowupButtonReply).not.toHaveBeenCalled();
  });
});

// ============================================================
// Inbound media / location classification — the gateway reports types
// in Baileys proto style (`ImageMessage`, `AudioMessage`, …); they must
// classify to the right content_type and get mirrored, not degrade to
// an "[Unsupported message type]" text row (whatsapp-messaging spec,
// "Inbound content-type classification tolerates gateway spelling variants").
// ============================================================
describe("inbound media classification", () => {
  it("an ImageMessage is stored as image with the mirrored media URL", async () => {
    h.resolveInboundMedia.mockResolvedValue({
      mediaUrl: "https://cdn.test/mirrored.jpg",
      mediaType: "image/jpeg",
    });

    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-img",
        messageType: "ImageMessage",
        text: "a caption",
      }),
    );

    expect(h.resolveInboundMedia).toHaveBeenCalledTimes(1);
    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "image",
      content_text: "a caption",
      media_url: "https://cdn.test/mirrored.jpg",
      media_type: "image/jpeg",
    });
  });

  it("an AudioMessage is stored as audio", async () => {
    h.resolveInboundMedia.mockResolvedValue({
      mediaUrl: "https://cdn.test/voice.ogg",
      mediaType: "audio/ogg",
    });

    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-aud",
        messageType: "AudioMessage",
        text: "",
      }),
    );

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "audio",
      media_url: "https://cdn.test/voice.ogg",
    });
  });

  it("a LocationMessage is stored as location, not unsupported text", async () => {
    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-loc",
        messageType: "LocationMessage",
        text: "",
      }),
    );

    expect(h.resolveInboundMedia).not.toHaveBeenCalled();
    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "location",
      content_text: "[Location]",
    });
  });

  it("a media message whose file cannot be resolved still persists with the media content_type", async () => {
    h.resolveInboundMedia.mockResolvedValue({
      mediaUrl: null,
      mediaType: null,
    });

    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-img-fail",
        messageType: "ImageMessage",
        text: "",
      }),
    );

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "image",
      media_url: null,
    });
  });

  it("a genuinely unknown messageType persists as text and logs the received type", async () => {
    const warn = vi.spyOn(console, "warn");

    await runWebhook(
      envelope("message", {
        ...TEXT_MESSAGE,
        messageid: "uaz-weird",
        messageType: "PollUpdateMessage",
        text: "",
      }),
    );

    expect(h.state.upsertCalls[0].row).toMatchObject({
      content_type: "text",
      content_text: "[Unsupported message type: PollUpdateMessage]",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unrecognised inbound messageType"),
      "PollUpdateMessage",
    );
  });
});

// ============================================================
// 4.8 — delivery-status updates
// ============================================================
describe("status updates", () => {
  it("progression: sent -> delivered is applied and mirrored to the recipient", async () => {
    h.state.messageRows = [
      {
        id: "row-1",
        status: "sent",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];
    h.state.recipient = { id: "rec-1", status: "sent" };

    await runWebhook(
      envelope("messages_update", { messageid: "uaz-1", status: "Delivered" }),
    );

    expect(h.state.messageStatusUpdates).toEqual([{ status: "delivered" }]);
    expect(h.state.recipientUpdates[0]).toMatchObject({ status: "delivered" });
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      "acc-1",
      "message.status_updated",
      expect.objectContaining({ status: "Delivered" }),
    );
  });

  it("regression: read -> sent is ignored", async () => {
    h.state.messageRows = [
      {
        id: "row-1",
        status: "read",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];
    await runWebhook(
      envelope("messages_update", { messageid: "uaz-1", status: "Sent" }),
    );
    expect(h.state.messageStatusUpdates).toHaveLength(0);
  });

  it("failure: stores the reported error text on the broadcast recipient", async () => {
    h.state.messageRows = [
      {
        id: "row-1",
        status: "sent",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];
    h.state.recipient = { id: "rec-1", status: "sent" };

    await runWebhook(
      envelope("messages_update", {
        messageid: "uaz-1",
        status: "Failed",
        error: "recipient unreachable",
      }),
    );

    expect(h.state.messageStatusUpdates).toEqual([{ status: "failed" }]);
    expect(h.state.recipientUpdates[0]).toMatchObject({
      status: "failed",
      error_message: "recipient unreachable",
    });
  });

  it("unknown message id: acknowledged, nothing written", async () => {
    h.state.messageRows = [];
    h.state.recipient = null;

    await runWebhook(
      envelope("messages_update", {
        messageid: "unknown-id",
        status: "Delivered",
      }),
    );

    expect(h.state.messageStatusUpdates).toHaveLength(0);
    expect(h.state.recipientUpdates).toHaveLength(0);
    expect(h.dispatchWebhookEvent).not.toHaveBeenCalled();
  });

  it("a replied recipient is never regressed by a late status echo", async () => {
    h.state.messageRows = [
      {
        id: "row-1",
        status: "delivered",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];
    h.state.recipient = { id: "rec-1", status: "replied" };

    await runWebhook(
      envelope("messages_update", { messageid: "uaz-1", status: "Read" }),
    );

    expect(h.state.recipientUpdates).toHaveLength(0);
  });
});

// ============================================================
// 4.9 — connection events
// ============================================================
describe("connection events", () => {
  it("connecting: updates the stored state", async () => {
    await runWebhook(
      envelope("connection", { instance: { status: "connecting" } }),
    );
    expect(h.state.configUpdates[0]).toMatchObject({
      connection_state: "connecting",
    });
  });

  it("connected: records the state, paired number, and pairing time", async () => {
    h.state.config = {
      ...h.BASE_CONFIG,
      connection_state: "connecting",
      paired_phone: null,
      paired_at: null,
    };
    await runWebhook(
      envelope("connection", {
        instance: { status: "connected" },
        jid: { user: "15551230000" },
      }),
    );
    expect(h.state.configUpdates[0]).toMatchObject({
      connection_state: "connected",
      paired_phone: "15551230000",
    });
    expect(h.state.configUpdates[0].paired_at).toBeTruthy();
  });

  it("disconnected (transient): updates state but retains the paired number", async () => {
    await runWebhook(
      envelope("connection", {
        instance: {
          status: "disconnected",
          lastDisconnectReason: "Network error",
        },
      }),
    );
    expect(h.state.configUpdates[0]).toMatchObject({
      connection_state: "disconnected",
      paired_phone: h.BASE_CONFIG.paired_phone,
      paired_at: h.BASE_CONFIG.paired_at,
    });
  });

  it("hibernated: updates state and retains the paired number", async () => {
    await runWebhook(
      envelope("connection", { instance: { status: "hibernated" } }),
    );
    expect(h.state.configUpdates[0]).toMatchObject({
      connection_state: "hibernated",
      paired_phone: h.BASE_CONFIG.paired_phone,
    });
  });

  it("a logged-out disconnect clears the paired number", async () => {
    await runWebhook(
      envelope("connection", {
        instance: {
          status: "disconnected",
          lastDisconnectReason: "Logged Out",
        },
      }),
    );
    expect(h.state.configUpdates[0]).toMatchObject({
      connection_state: "disconnected",
      paired_phone: null,
      paired_at: null,
    });
  });
});

// ============================================================
// 4.11 — downstream dispatch stays wired
// ============================================================
describe("downstream dispatch", () => {
  it("a genuine first delivery bumps the conversation and fans out to flows/automations/webhooks", async () => {
    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.rpcCalls).toHaveLength(1);
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: "bump_conversation_on_inbound",
    });
    expect(h.dispatchInboundToFlows).toHaveBeenCalledTimes(1);
    expect(h.runAutomationsForTrigger).toHaveBeenCalled();
    expect(h.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      "acc-1",
      "message.received",
      expect.anything(),
    );
  });
});

// ============================================================
// Event-type spelling aliases (design D1) — the gateway's subscribe-time
// name (`messages`) and its payload-enum name (`message`) must land on
// the same ingestion path with the same effect.
// ============================================================
describe("event-type aliases", () => {
  it("`message` and `messages` produce an identical persisted message row", async () => {
    await runWebhook(envelope("message", TEXT_MESSAGE));
    const singular = h.state.upsertCalls[0].row;

    // reset the per-call mutable state the same way beforeEach does —
    // `afterCallbacks` accumulates across runWebhook calls otherwise.
    h.state.afterCallbacks = [];
    h.state.upsertCalls = [];
    h.state.rpcCalls = [];

    await runWebhook(envelope("messages", TEXT_MESSAGE));
    const plural = h.state.upsertCalls[0].row;

    expect(plural).toEqual(singular);
    expect(plural).toMatchObject({
      conversation_id: "conv-1",
      sender_type: "customer",
      content_text: "hello",
      message_id: "uaz-1",
    });
  });

  it("`status` and `messages_update` both drive the delivery-status path", async () => {
    const rows = () => [
      {
        id: "row-1",
        status: "sent",
        conversation_id: "conv-1",
        conversations: { account_id: "acc-1" },
      },
    ];

    h.state.messageRows = rows();
    await runWebhook(
      envelope("messages_update", { messageid: "uaz-1", status: "Delivered" }),
    );
    const viaUpdate = [...h.state.messageStatusUpdates];

    h.state.afterCallbacks = [];
    h.state.messageStatusUpdates = [];
    h.state.messageRows = rows();
    await runWebhook(
      envelope("status", { messageid: "uaz-1", status: "Delivered" }),
    );

    expect(h.state.messageStatusUpdates).toEqual(viaUpdate);
    expect(viaUpdate).toEqual([{ status: "delivered" }]);
  });
});

// ============================================================
// Real captured envelope — an `EventType: "messages"` delivery in the
// exact shape UAZAPI POSTs (payload under `message`, type in `EventType`).
// ============================================================
describe("real UAZAPI inbound envelope", () => {
  it("persists an inbound text message from the real `messages` payload", async () => {
    await runWebhook({
      EventType: "messages",
      instanceName: "wacrm-52dd6807",
      token: "ff8b42d5",
      owner: "553391681812",
      chat: { id: "ra45066effa6853", name: "Marcos Ramos" },
      message: REAL_INBOUND_MESSAGE,
    });

    expect(h.findExistingContact).toHaveBeenCalledWith(
      expect.anything(),
      "acc-1",
      "553391276668",
    );
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.upsertCalls[0].row).toMatchObject({
      conversation_id: "conv-1",
      sender_type: "customer",
      content_type: "text",
      content_text: "Como está ?",
      message_id: "3A3BA53D870916CDC3CC",
      status: "delivered",
    });
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: "bump_conversation_on_inbound",
    });
  });
});

// ============================================================
// Idempotent replay — a redelivered messageid inserts no second row and
// fires downstream dispatch at most once (spec "Duplicate event delivery").
// ============================================================
describe("idempotent replay", () => {
  it("a second delivery of the same messageid writes no new row and does not re-dispatch", async () => {
    await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(h.state.rpcCalls).toHaveLength(1);

    // The unique (conversation_id, message_id) index turns the replay into
    // ON CONFLICT DO NOTHING, so `.select()` comes back empty.
    h.state.afterCallbacks = [];
    h.state.messageUpsertResult = [];
    h.runAutomationsForTrigger.mockClear();
    h.dispatchInboundToFlows.mockClear();

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.upsertCalls).toHaveLength(2);
    expect(h.state.rpcCalls).toHaveLength(1); // still just the first delivery's bump
    expect(h.dispatchInboundToFlows).not.toHaveBeenCalled();
    expect(h.runAutomationsForTrigger).not.toHaveBeenCalled();
  });
});

// ============================================================
// parseCtwa — pure narrowing of Message.content (design.md D10,
// meta-capi-qualified-lead task 2.1). UAZAPI types this field
// `oneOf: [object, string]`; both shapes must land on the same result.
// ============================================================
describe("parseCtwa", () => {
  it("extracts ctwaClid and sourceId from the real payload, object form", () => {
    expect(parseCtwa(REAL_CTWA_CONTENT)).toEqual({
      ctwaClid: REAL_CTWA_CTWA_CLID,
      sourceId: REAL_CTWA_SOURCE_ID,
    });
  });

  it("extracts the same result when content arrives JSON-serialized as a string", () => {
    expect(parseCtwa(JSON.stringify(REAL_CTWA_CONTENT))).toEqual({
      ctwaClid: REAL_CTWA_CTWA_CLID,
      sourceId: REAL_CTWA_SOURCE_ID,
    });
  });

  it("returns null for a message with no externalAdReply", () => {
    expect(parseCtwa({ contextInfo: {} })).toBeNull();
    expect(parseCtwa({})).toBeNull();
    expect(parseCtwa("plain text body")).toBeNull();
    expect(parseCtwa(undefined)).toBeNull();
  });

  it("returns null for an empty ctwaClid", () => {
    expect(
      parseCtwa({
        contextInfo: { externalAdReply: { ctwaClid: "", sourceID: "x" } },
      }),
    ).toBeNull();
  });

  it("returns null for malformed JSON in the string form", () => {
    expect(parseCtwa("{not json")).toBeNull();
  });
});

// ============================================================
// CTWA attribution capture on inbound ingestion (whatsapp-messaging spec,
// "Inbound ad attribution is captured on the contact"; tasks 2.2-2.5)
// ============================================================
describe("CTWA attribution capture", () => {
  it("captures ctwa_clid, ad_source_id and ctwa_clid_at on the contact", async () => {
    await runWebhook(envelope("message", CTWA_MESSAGE));

    expect(h.state.contactUpdates).toHaveLength(1);
    expect(h.state.contactUpdates[0]).toMatchObject({
      ctwa_clid: REAL_CTWA_CTWA_CLID,
      ad_source_id: REAL_CTWA_SOURCE_ID,
    });
    expect(h.state.contactUpdates[0].ctwa_clid_at).toBeTruthy();
    // The message itself still ingests normally.
    expect(h.state.upsertCalls).toHaveLength(1);
  });

  it("captures the same attribution when content arrives as a JSON string", async () => {
    await runWebhook(
      envelope("message", {
        ...CTWA_MESSAGE,
        content: JSON.stringify(REAL_CTWA_CONTENT),
      }),
    );

    expect(h.state.contactUpdates).toHaveLength(1);
    expect(h.state.contactUpdates[0]).toMatchObject({
      ctwa_clid: REAL_CTWA_CTWA_CLID,
      ad_source_id: REAL_CTWA_SOURCE_ID,
    });
  });

  it("an organic message (no ad-referral block) captures nothing", async () => {
    await runWebhook(envelope("message", TEXT_MESSAGE));
    expect(h.state.contactUpdates).toHaveLength(0);
  });

  it("a message with an empty ctwaClid captures nothing", async () => {
    await runWebhook(
      envelope("message", {
        ...CTWA_MESSAGE,
        content: {
          contextInfo: {
            externalAdReply: { ctwaClid: "", sourceID: "120250103171390297" },
          },
        },
      }),
    );
    expect(h.state.contactUpdates).toHaveLength(0);
  });

  it("a redelivered first message (same click already stored) does not move ctwa_clid_at", async () => {
    h.findExistingContact.mockResolvedValue({
      id: "contact-1",
      name: "Ada",
      phone: "15551230000",
      ctwa_clid: REAL_CTWA_CTWA_CLID,
    });

    await runWebhook(envelope("message", CTWA_MESSAGE));

    expect(h.state.contactUpdates).toHaveLength(0);
  });

  it("later messages with no referral block leave stored attribution unchanged", async () => {
    h.findExistingContact.mockResolvedValue({
      id: "contact-1",
      name: "Ada",
      phone: "15551230000",
      ctwa_clid: "old-click-id",
    });

    await runWebhook(envelope("message", TEXT_MESSAGE));

    expect(h.state.contactUpdates).toHaveLength(0);
  });

  it("a second, different ad click overwrites the first", async () => {
    h.findExistingContact.mockResolvedValue({
      id: "contact-1",
      name: "Ada",
      phone: "15551230000",
      ctwa_clid: "old-click-id",
    });

    await runWebhook(envelope("message", CTWA_MESSAGE));

    expect(h.state.contactUpdates).toHaveLength(1);
    expect(h.state.contactUpdates[0]).toMatchObject({
      ctwa_clid: REAL_CTWA_CTWA_CLID,
      ad_source_id: REAL_CTWA_SOURCE_ID,
    });
  });

  it("a capture failure is logged and never blocks message ingestion", async () => {
    h.state.contactUpdateShouldError = true;

    const res = await runWebhook(envelope("message", CTWA_MESSAGE));

    expect(res.init?.status ?? 200).toBe(200);
    expect(h.state.upsertCalls).toHaveLength(1);
    expect(console.error).toHaveBeenCalledWith(
      "[webhook] ctwa attribution capture failed:",
      "contact update boom",
    );
  });
});
