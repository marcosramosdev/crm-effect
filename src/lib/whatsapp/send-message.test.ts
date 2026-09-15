import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from "./send-message";

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error("db should not be queried for invalid params");
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp,
) {
  await expect(
    sendMessageToConversation(noDb(), "acct-1", params),
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), "acct-1", params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    },
  );
}

describe("sendMessageToConversation — param validation (pre-DB)", () => {
  const base = { conversationId: "cv-1" };

  it("requires conversation_id and message_type", async () => {
    await expectSendError({ conversationId: "", messageType: "text" }, 400);
    await expectSendError({ conversationId: "cv-1", messageType: "" }, 400);
  });

  it("rejects an unsupported message_type", async () => {
    await expectSendError(
      { ...base, messageType: "carrier-pigeon" },
      400,
      /Unsupported message_type/,
    );
  });

  it('rejects the removed "template" message type by name', async () => {
    await expectSendError(
      { ...base, messageType: "template" },
      400,
      /template.*no longer supported/i,
    );
  });

  it("requires content_text for text messages", async () => {
    await expectSendError(
      { ...base, messageType: "text" },
      400,
      /content_text is required/,
    );
  });

  it("requires media_url for media kinds", async () => {
    for (const kind of ["image", "video", "document", "audio"]) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/,
      );
    }
  });

  it("rejects an over-long media caption (non-audio)", async () => {
    await expectSendError(
      {
        ...base,
        messageType: "image",
        mediaUrl: "https://x/y.jpg",
        contentText: "a".repeat(1025),
      },
      400,
      /1024-character limit/,
    );
  });

  it("requires a valid interactive payload for interactive messages", async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: "interactive" },
      400,
      /payload is required/,
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: "interactive",
        interactivePayload: {
          kind: "buttons",
          body: "Pick one",
          buttons: [
            { id: "a", title: "A" },
            { id: "b", title: "B" },
            { id: "c", title: "C" },
            { id: "d", title: "D" },
          ],
        },
      },
      400,
      /at most 3 buttons/,
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: "interactive",
        interactivePayload: {
          kind: "buttons",
          body: "Pick one",
          buttons: [{ id: "a", title: "x".repeat(21) }],
        },
      },
      400,
      /20-character limit/,
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error("reached DB");
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, "acct-1", {
        ...base,
        messageType: "audio",
        mediaUrl: "https://x/y.ogg",
        contentText: "a".repeat(2000),
      }),
    ).rejects.toThrow("reached DB");
    expect(spy).toHaveBeenCalledWith("conversations");
  });
});

describe("SendMessageError", () => {
  it("carries a machine code and an HTTP status", () => {
    const e = new SendMessageError("gateway_error", "boom", 502);
    expect(e.code).toBe("gateway_error");
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

// ============================================================
// Full send path — against the UAZAPI transport.
// ============================================================

const sendTextMessage = vi.fn(async () => ({ messageId: "wamid.text" }));
const sendMediaMessage = vi.fn(async () => ({ messageId: "wamid.media" }));
const sendInteractiveButtons = vi.fn(async () => ({ messageId: "wamid.btn" }));
const sendInteractiveList = vi.fn(async () => ({ messageId: "wamid.list" }));

// Stub only the senders — the module also exports INTERACTIVE_LIMITS,
// `assertMediaWithinInlineLimit`, and `MediaTooLargeError`, which
// send-message.ts and interactive.ts's validator both need for real.
vi.mock("@/lib/whatsapp/uazapi", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  sendTextMessage: (...args: unknown[]) =>
    (sendTextMessage as unknown as (...a: unknown[]) => unknown)(...args),
  sendMediaMessage: (...args: unknown[]) =>
    (sendMediaMessage as unknown as (...a: unknown[]) => unknown)(...args),
  sendInteractiveButtons: (...args: unknown[]) =>
    (sendInteractiveButtons as unknown as (...a: unknown[]) => unknown)(
      ...args,
    ),
  sendInteractiveList: (...args: unknown[]) =>
    (sendInteractiveList as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
  isLegacyFormat: () => false,
}));

vi.mock("@/lib/flows/admin-client", () => ({
  // Only used for the best-effort "pause active flow run" write.
  supabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
      }),
    }),
  }),
}));

interface CapturedWrites {
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  contactPhone?: string;
}

/**
 * Supabase fake covering the tables the send path touches. `configState`
 * lets a test swap in a disconnected instance or a missing one.
 */
function sendPathDb(
  captured: CapturedWrites,
  configState: Partial<{
    instance_token: string | null;
    connection_state: string;
  }> = {},
): SupabaseClient {
  const conversation = {
    id: "cv-1",
    contact: { id: "ct-1", phone: "+15551234567" },
  };
  const config = {
    instance_token: "instance-token",
    connection_state: "connected",
    ...configState,
  };

  return {
    from(table: string) {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        insert: (row: Record<string, unknown>) => {
          if (table === "messages") captured.message = row;
          return builder;
        },
        update: (row: Record<string, unknown>) => {
          if (table === "conversations") captured.conversation = row;
          if (table === "contacts") captured.contactPhone = row.phone as string;
          return builder;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => {
          if (table === "conversations") {
            return { data: conversation, error: null };
          }
          if (table === "whatsapp_config") return { data: config, error: null };
          if (table === "messages") {
            return { data: { id: "msg-1" }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (r: { error: null }) => unknown) =>
          resolve({ error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("sendMessageToConversation — text send", () => {
  afterEach(() => {
    sendTextMessage.mockClear();
  });

  it("sends via the instance token and persists the gateway message id", async () => {
    const captured: CapturedWrites = {};
    const result = await sendMessageToConversation(
      sendPathDb(captured),
      "acct-1",
      { conversationId: "cv-1", messageType: "text", contentText: "Hi there" },
    );

    expect(result.whatsappMessageId).toBe("wamid.text");
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    const args = (sendTextMessage.mock.calls[0] as unknown[])[0] as {
      token: string;
      to: string;
    };
    expect(args.token).toBe("instance-token");
    expect(args.to).toBe("15551234567");

    expect(captured.message?.content_text).toBe("Hi there");
    expect(captured.message?.status).toBe("sent");
    expect(captured.conversation?.last_message_text).toBe("Hi there");
  });
});

describe("sendMessageToConversation — phone-variant retry (5.5)", () => {
  afterEach(() => {
    sendTextMessage.mockReset();
    sendTextMessage.mockResolvedValue({ messageId: "wamid.text" });
  });

  it("retries the next phone-number variant when the gateway reports it unreachable", async () => {
    let call = 0;
    sendTextMessage.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("invalid number");
      return { messageId: "wamid.retry" };
    });

    const captured: CapturedWrites = {};
    const result = await sendMessageToConversation(
      sendPathDb(captured),
      "acct-1",
      { conversationId: "cv-1", messageType: "text", contentText: "Hi" },
    );

    expect(result.whatsappMessageId).toBe("wamid.retry");
    expect(sendTextMessage.mock.calls.length).toBeGreaterThanOrEqual(2);
    // The working variant is persisted back onto the contact.
    expect(captured.contactPhone).toBeTruthy();
    expect(captured.contactPhone).not.toBe("15551234567");
  });

  it("persists a failed message row once every variant is rejected as unreachable", async () => {
    sendTextMessage.mockImplementation(async () => {
      throw new Error("recipient is not on WhatsApp");
    });

    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(sendPathDb(captured), "acct-1", {
        conversationId: "cv-1",
        messageType: "text",
        contentText: "Hi",
      }),
    ).rejects.toMatchObject({ code: "recipient_unreachable", status: 400 });

    expect(captured.message).toMatchObject({
      status: "failed",
      content_text: "Hi",
    });
  });

  it("does not retry or persist a failed row for a non-recipient failure", async () => {
    sendTextMessage.mockImplementation(async () => {
      throw new Error("Rate limit exceeded");
    });

    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(sendPathDb(captured), "acct-1", {
        conversationId: "cv-1",
        messageType: "text",
        contentText: "Hi",
      }),
    ).rejects.toMatchObject({ code: "gateway_error" });

    // Only the first variant was tried — no retry for a non-recipient cause.
    expect(sendTextMessage).toHaveBeenCalledTimes(1);
    expect(captured.message).toBeUndefined();
  });
});

describe("sendMessageToConversation — disconnected instance (5.3)", () => {
  it("fails before any gateway call when connection_state is not connected", async () => {
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb(captured, { connection_state: "disconnected" }),
        "acct-1",
        { conversationId: "cv-1", messageType: "text", contentText: "Hi" },
      ),
    ).rejects.toMatchObject({ code: "whatsapp_disconnected", status: 400 });

    expect(sendTextMessage).not.toHaveBeenCalled();
  });

  it("fails when no instance has been provisioned at all", async () => {
    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(
        sendPathDb(captured, { instance_token: null }),
        "acct-1",
        { conversationId: "cv-1", messageType: "text", contentText: "Hi" },
      ),
    ).rejects.toMatchObject({ code: "whatsapp_not_configured", status: 400 });

    expect(sendTextMessage).not.toHaveBeenCalled();
  });
});

describe("sendMessageToConversation — outbound media (5.4)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    sendMediaMessage.mockClear();
    vi.unstubAllEnvs();
  });

  it("reads the stored object once, base64-encodes it, and sends it inline", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb(captured), "acct-1", {
      conversationId: "cv-1",
      messageType: "image",
      mediaUrl: "https://storage.example.com/chat-media/account-1/photo.jpg",
      contentText: "A photo",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMediaMessage).toHaveBeenCalledTimes(1);
    const args = (sendMediaMessage.mock.calls[0] as unknown[])[0] as {
      fileBase64: string;
      mimetype: string;
    };
    expect(args.fileBase64).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
    expect(args.mimetype).toBe("image/jpeg");
  });

  it("forwards voice:true as asVoiceNote and still persists content_type audio", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "audio/ogg" },
      arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb(captured), "acct-1", {
      conversationId: "cv-1",
      messageType: "audio",
      mediaUrl: "https://storage.example.com/chat-media/account-1/voice.ogg",
      voice: true,
    });

    expect(sendMediaMessage).toHaveBeenCalledTimes(1);
    const args = (sendMediaMessage.mock.calls[0] as unknown[])[0] as {
      asVoiceNote?: boolean;
    };
    expect(args.asVoiceNote).toBe(true);
    expect(captured.message?.content_type).toBe("audio");
  });

  it("sends audio without voice as an ordinary attachment", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "audio/mpeg" },
      arrayBuffer: async () => new Uint8Array([1, 1]).buffer,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const captured: CapturedWrites = {};
    await sendMessageToConversation(sendPathDb(captured), "acct-1", {
      conversationId: "cv-1",
      messageType: "audio",
      mediaUrl: "https://storage.example.com/chat-media/account-1/clip.mp3",
    });

    const args = (sendMediaMessage.mock.calls[0] as unknown[])[0] as {
      asVoiceNote?: boolean;
    };
    expect(args.asVoiceNote).toBe(false);
  });

  it("rejects media over the inline size ceiling without calling the gateway", async () => {
    vi.stubEnv("UAZAPI_MAX_INLINE_MEDIA_BYTES", "2");
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const captured: CapturedWrites = {};
    await expect(
      sendMessageToConversation(sendPathDb(captured), "acct-1", {
        conversationId: "cv-1",
        messageType: "image",
        mediaUrl: "https://storage.example.com/chat-media/account-1/photo.jpg",
      }),
    ).rejects.toMatchObject({ code: "media_too_large", status: 400 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sendMediaMessage).not.toHaveBeenCalled();
    expect(captured.message).toBeUndefined();
  });
});
