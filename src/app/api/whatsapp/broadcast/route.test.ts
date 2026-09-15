import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Tests for the dashboard wizard's per-batch send endpoint. Retargeted at
// the UAZAPI migration (design.md D1/D5): there is no template or
// server-side variable substitution any more — the caller already resolved
// each recipient's final text, and this route's only job is the free-form
// send + phone-variant retry, fanned out over the batch.
// ---------------------------------------------------------------------------

let callerRole: string = "agent";
let connectionState: string = "connected";

function makeSupabaseMock() {
  function builder(table: string) {
    const selectResult = () => {
      switch (table) {
        case "profiles":
          return {
            data: { account_id: "acct-1", account_role: callerRole },
            error: null,
          };
        case "accounts":
          return { data: { id: "acct-1", name: "Acme" }, error: null };
        case "whatsapp_config":
          return {
            data: {
              instance_token: "enc-token",
              connection_state: connectionState,
            },
            error: null,
          };
        default:
          return { data: null, error: null };
      }
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ["select", "eq", "in", "order", "limit"])
      b[m] = vi.fn(chain);
    b.single = vi.fn(() => Promise.resolve(selectResult()));
    b.maybeSingle = vi.fn(() => Promise.resolve(selectResult()));
    b.then = (resolve: (v: unknown) => unknown) => resolve(selectResult());
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

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: vi.fn(() => "plaintext-token"),
}));

const { sendTextMessage, sendMediaMessage, fetchMediaAsBase64 } = vi.hoisted(
  () => ({
    sendTextMessage: vi.fn(async () => ({ messageId: "wamid-1" })),
    sendMediaMessage: vi.fn(async () => ({ messageId: "wamid-media-1" })),
    fetchMediaAsBase64: vi.fn(async () => ({
      fileBase64: "YQ==",
      mimetype: "image/png",
    })),
  }),
);
vi.mock("@/lib/whatsapp/uazapi", () => ({
  sendTextMessage,
  sendMediaMessage,
  fetchMediaAsBase64,
}));

import { POST } from "./route";

function postBroadcast(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request("http://localhost/api/whatsapp/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipients: [{ phone: "+14155550123", text: "Hi Jane!" }],
        ...overrides,
      }),
    }),
  );
}

describe("POST /api/whatsapp/broadcast", () => {
  beforeEach(() => {
    callerRole = "agent";
    connectionState = "connected";
    supabaseMock = makeSupabaseMock();
    sendTextMessage.mockClear();
    sendMediaMessage.mockClear();
    fetchMediaAsBase64.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends free-form text to every recipient and reports per-recipient results", async () => {
    const res = await postBroadcast({
      recipients: [
        { phone: "+14155550123", text: "Hi Jane!" },
        { phone: "+14155550124", text: "Hi Bob!" },
      ],
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.sent).toBe(2);
    expect(json.failed).toBe(0);
    expect(sendTextMessage).toHaveBeenCalledTimes(2);
    const firstCallArgs = (
      sendTextMessage.mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(firstCallArgs).toMatchObject({
      to: "14155550123",
      text: "Hi Jane!",
    });
    expect(json.results[0]).toMatchObject({
      phone: "+14155550123",
      status: "sent",
      whatsapp_message_id: "wamid-1",
    });
  });

  it("rejects an invalid phone without calling the gateway for that recipient", async () => {
    const res = await postBroadcast({
      recipients: [{ phone: "not-a-phone", text: "Hi!" }],
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.failed).toBe(1);
    expect(json.results[0]).toMatchObject({ status: "failed" });
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("reads the shared attachment once and sends media with each caption", async () => {
    const res = await postBroadcast({
      recipients: [
        { phone: "+14155550123", text: "Caption for Jane" },
        { phone: "+14155550124", text: "Caption for Bob" },
      ],
      media_url: "https://example.com/chat-media/f.png",
      media_kind: "image",
    });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMediaAsBase64).toHaveBeenCalledTimes(1);
    expect(sendMediaMessage).toHaveBeenCalledTimes(2);
    const firstMediaCallArgs = (
      sendMediaMessage.mock.calls[0] as unknown[]
    )[0] as Record<string, unknown>;
    expect(firstMediaCallArgs).toMatchObject({
      kind: "image",
      caption: "Caption for Jane",
      fileBase64: "YQ==",
    });
    expect(json.sent).toBe(2);
  });

  it("400s when the instance is disconnected, before any send", async () => {
    connectionState = "disconnected";
    const res = await postBroadcast();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not connected/i);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("refuses a viewer with 403 and never reaches the gateway", async () => {
    callerRole = "viewer";
    const res = await postBroadcast();

    expect(res.status).toBe(403);
    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});
