import { afterEach, describe, expect, it, vi } from "vitest";

// The route delegates auth, conversation resolution, and the actual
// send to three collaborators. This suite mocks all three and asserts
// the route's own job: mapping the request body (including the
// `voice` flag and the `type: "voice"` shorthand) onto the send-core
// params.

const { requireApiKey, resolveConversationByPhone, sendMessageToConversation } =
  vi.hoisted(() => ({
    requireApiKey: vi.fn(async () => ({
      authType: "api_key" as const,
      supabase: {},
      accountId: "acct-1",
      keyId: "key-1",
      scopes: ["messages:send"],
      createdBy: "user-1",
    })),
    resolveConversationByPhone: vi.fn(async () => ({
      conversationId: "conv-1",
      contactId: "contact-1",
      contactCreated: false,
    })),
    sendMessageToConversation: vi.fn(async () => ({
      messageId: "msg-1",
      whatsappMessageId: "wamid-1",
    })),
  }));

vi.mock("@/lib/auth/api-context", () => ({ requireApiKey }));
vi.mock("@/lib/whatsapp/resolve-conversation", () => ({
  resolveConversationByPhone,
}));
vi.mock("@/lib/whatsapp/send-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/whatsapp/send-message")>()),
  sendMessageToConversation,
}));

import { POST } from "./route";

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/v1/messages — voice", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('maps type "voice" to an audio send with voice:true and 201s', async () => {
    const res = await post({
      to: "+15551234567",
      type: "voice",
      media_url: "https://storage.example.com/chat-media/acct-1/voice.ogg",
    });

    expect(res.status).toBe(201);
    expect(sendMessageToConversation).toHaveBeenCalledTimes(1);
    const params = (
      sendMessageToConversation.mock.calls[0] as unknown[]
    )[2] as {
      messageType: string;
      voice: boolean;
    };
    expect(params.messageType).toBe("audio");
    expect(params.voice).toBe(true);
  });

  it('accepts an explicit voice:true alongside type "audio"', async () => {
    await post({
      to: "+15551234567",
      type: "audio",
      media_url: "https://storage.example.com/chat-media/acct-1/voice.ogg",
      voice: true,
    });

    const params = (
      sendMessageToConversation.mock.calls[0] as unknown[]
    )[2] as {
      messageType: string;
      voice: boolean;
    };
    expect(params.messageType).toBe("audio");
    expect(params.voice).toBe(true);
  });

  it('type "audio" with no flag sends an ordinary audio file', async () => {
    await post({
      to: "+15551234567",
      type: "audio",
      media_url: "https://storage.example.com/chat-media/acct-1/clip.mp3",
    });

    const params = (
      sendMessageToConversation.mock.calls[0] as unknown[]
    )[2] as {
      messageType: string;
      voice: boolean;
    };
    expect(params.messageType).toBe("audio");
    expect(params.voice).toBe(false);
  });
});
