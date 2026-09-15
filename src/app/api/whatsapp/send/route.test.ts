import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tests for the `contact_id` send path (issue #296): sending a free-form
// text message to a single contact from the Contact detail view. The route
// must find-or-create the contact's conversation server-side, then run the
// normal send + persistence path — no inbound message required to bootstrap
// a thread.
//
// Retargeted from the Meta-template version of this file at the UAZAPI
// migration — templates no longer exist (design.md D5), so the exercised
// path is a plain text send.
// ---------------------------------------------------------------------------

// Records of what the route wrote, so we can assert the right rows landed.
const conversationInserts: Array<Record<string, unknown>> = [];
const messageInserts: Array<Record<string, unknown>> = [];
// Deletes the route issued (the phone-path rollback), and canned
// `count` answers for the rollback's head/count guard queries.
const deleteCalls: Array<{ table: string; filters: Record<string, unknown> }> =
  [];
let countByTable: Record<string, number> = {};

// Toggles for the per-test scenario.
let existingConversation: Record<string, unknown> | null = null;
let contactRow: Record<string, unknown> | null = null;
// The caller's role, as `requireRole` reads it off the profile. Sending
// requires 'agent'; 'viewer' must be refused before anything reaches UAZAPI.
let callerRole: string = "admin";
// A conversation created during the request becomes retrievable by id —
// the shared send core re-loads the conversation (with its contact) from
// just the id, so the mock must model insert-then-select-by-id.
let createdConversation: Record<string, unknown> | null = null;

const CONTACT = {
  id: "contact-1",
  account_id: "acct-1",
  phone: "+15551234567",
};

// Chainable Supabase mock. A fresh builder per `.from()` call tracks whether
// `.insert()` ran so the terminal resolves to the inserted row for creates
// and the canned select row otherwise.
function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false;

    const selectResult = () => {
      switch (table) {
        case "profiles":
          return {
            data: { account_id: "acct-1", account_role: callerRole },
            error: null,
          };
        case "accounts":
          return {
            data: { id: "acct-1", name: "Acme", owner_user_id: "user-1" },
            error: null,
          };
        case "contacts":
          return { data: contactRow, error: null };
        case "conversations":
          // Once created this request, a by-id reload returns it (with
          // its contact); otherwise fall back to the canned existing row.
          return {
            data: createdConversation ?? existingConversation,
            error: null,
          };
        case "whatsapp_config":
          return {
            data: {
              id: "cfg-1",
              account_id: "acct-1",
              user_id: "user-1",
              instance_token: "enc-token",
              connection_state: "connected",
            },
            error: null,
          };
        default:
          return { data: null, error: null };
      }
    };

    const insertResult = () => {
      switch (table) {
        case "conversations":
          return {
            data: {
              id: "conv-new",
              account_id: "acct-1",
              contact_id: "contact-1",
              contact: CONTACT,
            },
            error: null,
          };
        case "messages":
          return { data: { id: "msg-1" }, error: null };
        default:
          return { data: null, error: null };
      }
    };

    let didDelete = false;
    let isCountQuery = false;
    const filters: Record<string, unknown> = {};

    const settle = () => {
      if (didDelete) {
        deleteCalls.push({ table, filters: { ...filters } });
        return { data: null, error: null };
      }
      if (isCountQuery) {
        return { data: null, count: countByTable[table] ?? 0, error: null };
      }
      return didInsert ? insertResult() : selectResult();
    };

    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["in", "order", "limit", "update", "like"]) {
      b[m] = vi.fn(chain);
    }
    b.select = vi.fn(
      (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.head) isCountQuery = true;
        return b;
      },
    );
    b.eq = vi.fn((col: string, val: unknown) => {
      filters[col] = val;
      return b;
    });
    b.delete = vi.fn(() => {
      didDelete = true;
      return b;
    });
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true;
      if (table === "conversations") {
        conversationInserts.push(payload);
        createdConversation = {
          id: "conv-new",
          account_id: "acct-1",
          contact_id: "contact-1",
          contact: CONTACT,
        };
      }
      if (table === "messages") messageInserts.push(payload);
      return b;
    });
    b.single = vi.fn(() => Promise.resolve(settle()));
    b.maybeSingle = vi.fn(() => Promise.resolve(settle()));
    b.then = (resolve: (v: unknown) => unknown) => resolve(settle());
    return b;
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1" } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  };
}

let supabaseMock = makeSupabaseMock();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      const chain = () => b;
      for (const m of ["update", "eq", "select"]) b[m] = vi.fn(chain);
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error: null });
      return b;
    },
  }),
}));

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: vi.fn(() => "plaintext-token"),
  encrypt: vi.fn(() => "enc-token"),
  isLegacyFormat: vi.fn(() => false),
}));

// `resolveConversationByPhone` has its own thorough unit tests
// (resolve-conversation.test.ts). Here we mock it so the route's NEW
// behaviour on top of it — target mutual-exclusivity, error mapping,
// and the failed-send rollback (design.md D5) — can be asserted in
// isolation.
const { resolveConversationByPhoneMock } = vi.hoisted(() => ({
  resolveConversationByPhoneMock: vi.fn(),
}));
vi.mock("@/lib/whatsapp/resolve-conversation", () => ({
  resolveConversationByPhone: resolveConversationByPhoneMock,
}));

const { sendTextMessage, sendMediaMessage } = vi.hoisted(() => ({
  sendTextMessage: vi.fn(async () => ({ messageId: "wamid-1" })),
  sendMediaMessage: vi.fn(async () => ({ messageId: "wamid-media" })),
}));
vi.mock("@/lib/whatsapp/uazapi", () => ({
  sendTextMessage,
  sendMediaMessage,
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  assertMediaWithinInlineLimit: vi.fn(),
  MediaTooLargeError: class MediaTooLargeError extends Error {},
}));

import { SendMessageError } from "@/lib/whatsapp/send-message";
import { POST } from "./route";

function postContactText(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/whatsapp/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_id: "contact-1",
        message_type: "text",
        content_text: "Hi Acme, your order #1234 shipped.",
        ...overrides,
      }),
    }),
  );
}

describe("POST /api/whatsapp/send — contact_id text path", () => {
  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    existingConversation = null;
    createdConversation = null;
    contactRow = CONTACT;
    callerRole = "admin";
    supabaseMock = makeSupabaseMock();
    sendTextMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates a conversation for a contact with none, then sends the text", async () => {
    const res = await postContactText();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.whatsapp_message_id).toBe("wamid-1");

    // A conversation was created for this contact.
    expect(conversationInserts).toHaveLength(1);
    expect(conversationInserts[0]).toMatchObject({
      account_id: "acct-1",
      contact_id: "contact-1",
    });

    // The text was sent to the contact's number.
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const args = (sendTextMessage.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    // UAZAPI wants the bare E.164 digits — sanitizePhoneForMeta strips the '+'.
    expect(args.to).toBe("15551234567");
    expect(args.text).toBe("Hi Acme, your order #1234 shipped.");

    // The outbound message was persisted under the new conversation.
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0]).toMatchObject({
      conversation_id: "conv-new",
      content_type: "text",
      content_text: "Hi Acme, your order #1234 shipped.",
      sender_type: "agent",
    });
  });

  it("reuses an existing conversation instead of creating a duplicate", async () => {
    existingConversation = {
      id: "conv-existing",
      account_id: "acct-1",
      contact_id: "contact-1",
      contact: CONTACT,
    };

    const res = await postContactText();
    expect(res.status).toBe(200);

    expect(conversationInserts).toHaveLength(0);
    expect(messageInserts[0]).toMatchObject({
      conversation_id: "conv-existing",
    });
  });

  it("404s when the contact is not in the caller account", async () => {
    contactRow = null;

    const res = await postContactText();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/contact not found/i);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("400s when neither conversation_id nor contact_id is provided", async () => {
    const res = await POST(
      new Request("http://localhost/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_type: "text", content_text: "hi" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects the removed "template" message type before touching the gateway', async () => {
    const res = await postContactText({
      message_type: "template",
      content_text: undefined,
      template_name: "order_update",
    });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no longer supported/i);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(messageInserts).toHaveLength(0);
  });
});

describe("POST /api/whatsapp/send — voice flag", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    existingConversation = {
      id: "conv-existing",
      account_id: "acct-1",
      contact_id: "contact-1",
      contact: CONTACT,
    };
    createdConversation = null;
    contactRow = CONTACT;
    callerRole = "agent";
    supabaseMock = makeSupabaseMock();
    sendMediaMessage.mockClear();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "audio/ogg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("forwards voice:true to the send core as asVoiceNote", async () => {
    const res = await postContactText({
      message_type: "audio",
      content_text: undefined,
      media_url: "https://storage.example.com/chat-media/acct-1/voice.ogg",
      voice: true,
    });

    expect(res.status).toBe(200);
    expect(sendMediaMessage).toHaveBeenCalledTimes(1);
    const args = (sendMediaMessage.mock.calls[0] as unknown[])[0] as {
      asVoiceNote?: boolean;
    };
    expect(args.asVoiceNote).toBe(true);
  });

  it("omitting voice sends audio as an ordinary attachment", async () => {
    const res = await postContactText({
      message_type: "audio",
      content_text: undefined,
      media_url: "https://storage.example.com/chat-media/acct-1/clip.mp3",
    });

    expect(res.status).toBe(200);
    const args = (sendMediaMessage.mock.calls[0] as unknown[])[0] as {
      asVoiceNote?: boolean;
    };
    expect(args.asVoiceNote).toBe(false);
  });
});

describe("POST /api/whatsapp/send — role enforcement", () => {
  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    existingConversation = {
      id: "conv-existing",
      account_id: "acct-1",
      contact_id: "contact-1",
      contact: CONTACT,
    };
    createdConversation = null;
    contactRow = CONTACT;
    callerRole = "admin";
    supabaseMock = makeSupabaseMock();
    sendTextMessage.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refuses a viewer with 403 and never reaches the gateway", async () => {
    // A viewer is read-only (`canSendMessages`). The route used to resolve
    // account_id straight off the profile with no role check: RLS blocked
    // the message INSERT, but the send core calls the gateway first, so
    // the customer still received a real WhatsApp message that RLS could
    // not un-send. The gate has to come before any outbound call.
    callerRole = "viewer";

    const res = await postContactText();

    expect(res.status).toBe(403);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(messageInserts).toHaveLength(0);
  });

  it("allows an agent through", async () => {
    callerRole = "agent";

    const res = await postContactText();

    expect(res.status).toBe(200);
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// The `to` (bare phone number) send path — start-a-conversation dialog.
// Covers the whatsapp-messaging delta: "Dashboard sends can target a phone
// number".
// ---------------------------------------------------------------------------
describe("POST /api/whatsapp/send — to (phone) path", () => {
  function postTo(overrides: Record<string, unknown> = {}) {
    return POST(
      new Request("http://localhost/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "+15559998888",
          message_type: "text",
          content_text: "Hello — reaching out from Acme.",
          ...overrides,
        }),
      }),
    );
  }

  const NEW_CONV = {
    id: "conv-new",
    account_id: "acct-1",
    contact_id: "contact-new",
    contact: { id: "contact-new", account_id: "acct-1", phone: "+15559998888" },
  };

  beforeEach(() => {
    conversationInserts.length = 0;
    messageInserts.length = 0;
    deleteCalls.length = 0;
    countByTable = {};
    existingConversation = NEW_CONV;
    createdConversation = null;
    contactRow = CONTACT;
    callerRole = "agent";
    supabaseMock = makeSupabaseMock();
    sendTextMessage.mockReset();
    sendTextMessage.mockResolvedValue({ messageId: "wamid-1" });
    resolveConversationByPhoneMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("creates the contact + conversation + outbound message for an unknown number", async () => {
    resolveConversationByPhoneMock.mockResolvedValue({
      conversationId: "conv-new",
      contactId: "contact-new",
      contactCreated: true,
      conversationCreated: true,
    });

    const res = await postTo();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.contact_id).toBe("contact-new");
    expect(json.contact_created).toBe(true);

    expect(resolveConversationByPhoneMock).toHaveBeenCalledWith(
      supabaseMock,
      "acct-1",
      "+15559998888",
      null,
    );
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0]).toMatchObject({
      conversation_id: "conv-new",
      content_type: "text",
      sender_type: "agent",
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("reuses the existing contact + conversation for a known number, no duplicate", async () => {
    existingConversation = {
      id: "conv-existing",
      account_id: "acct-1",
      contact_id: "contact-1",
      contact: CONTACT,
    };
    resolveConversationByPhoneMock.mockResolvedValue({
      conversationId: "conv-existing",
      contactId: "contact-1",
      contactCreated: false,
      conversationCreated: false,
    });

    const res = await postTo();
    expect(res.status).toBe(200);

    expect(conversationInserts).toHaveLength(0);
    expect(messageInserts[0]).toMatchObject({
      conversation_id: "conv-existing",
    });
    expect(deleteCalls).toHaveLength(0);
  });

  it("rolls back the contact + conversation it created when the gateway fails", async () => {
    resolveConversationByPhoneMock.mockResolvedValue({
      conversationId: "conv-new",
      contactId: "contact-new",
      contactCreated: true,
      conversationCreated: true,
    });
    sendTextMessage.mockRejectedValue(new Error("gateway exploded"));

    const res = await postTo();
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toMatch(/gateway/i);

    // Conversation deleted first (no messages), then the contact (no
    // remaining conversations, no deals).
    expect(deleteCalls.map((d) => d.table)).toEqual([
      "conversations",
      "contacts",
    ]);
    expect(deleteCalls[0].filters).toMatchObject({
      id: "conv-new",
      account_id: "acct-1",
    });
    expect(deleteCalls[1].filters).toMatchObject({
      id: "contact-new",
      account_id: "acct-1",
    });
    expect(messageInserts).toHaveLength(0);
  });

  it("leaves a pre-existing contact + thread intact when the gateway fails", async () => {
    resolveConversationByPhoneMock.mockResolvedValue({
      conversationId: "conv-existing",
      contactId: "contact-1",
      contactCreated: false,
      conversationCreated: false,
    });
    sendTextMessage.mockRejectedValue(new Error("gateway exploded"));

    const res = await postTo();

    expect(res.status).toBe(502);
    expect(deleteCalls).toHaveLength(0);
    expect(messageInserts).toHaveLength(0);
  });

  it("keeps the conversation when an inbound message arrived before the rollback", async () => {
    resolveConversationByPhoneMock.mockResolvedValue({
      conversationId: "conv-new",
      contactId: "contact-new",
      contactCreated: true,
      conversationCreated: true,
    });
    // The gap race: an inbound message landed on the new conversation,
    // so it now has a message AND the contact has a live conversation.
    countByTable = { messages: 1, conversations: 1 };
    sendTextMessage.mockRejectedValue(new Error("gateway exploded"));

    const res = await postTo();

    expect(res.status).toBe(502);
    expect(deleteCalls).toHaveLength(0);
  });

  it("400s a malformed number before any gateway call", async () => {
    resolveConversationByPhoneMock.mockRejectedValue(
      new SendMessageError(
        "bad_request",
        "'to' must be a valid phone number in E.164 format",
        400,
      ),
    );

    const res = await postTo({ to: "not-a-phone" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/E\.164/);
    expect(sendTextMessage).not.toHaveBeenCalled();
    expect(deleteCalls).toHaveLength(0);
  });

  it("400s when more than one target is supplied", async () => {
    const res = await postTo({ contact_id: "contact-1" });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/exactly one/i);
    expect(resolveConversationByPhoneMock).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("refuses a viewer on the to path with 403, before any resolution", async () => {
    callerRole = "viewer";

    const res = await postTo();

    expect(res.status).toBe(403);
    expect(resolveConversationByPhoneMock).not.toHaveBeenCalled();
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
