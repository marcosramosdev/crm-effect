import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MediaTooLargeError,
  assertMediaWithinInlineLimit,
  downloadMessageMedia,
  maxInlineMediaBytes,
  sendMediaMessage,
  sendReactionMessage,
  sendTextMessage,
} from "./uazapi";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendTextMessage / sendMediaMessage", () => {
  beforeEach(() => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends a plain text message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-1" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendTextMessage({
      token: "t",
      to: "5511999999999",
      text: "hi",
    });

    expect(result).toEqual({ messageId: "wamid-1" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/send/text");
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999999999",
      text: "hi",
    });
  });

  it("includes replyid when replying to a message", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-2" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendTextMessage({
      token: "t",
      to: "5511999999999",
      text: "reply",
      replyToMessageId: "orig-id",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999999999",
      text: "reply",
      replyid: "orig-id",
    });
  });

  it("sends an image with a caption", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-3" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendMediaMessage({
      token: "t",
      to: "5511999999999",
      kind: "image",
      fileBase64: "aGVsbG8=",
      mimetype: "image/jpeg",
      caption: "Look!",
    });

    expect(result).toEqual({ messageId: "wamid-3" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/send/media");
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999999999",
      type: "image",
      file: "aGVsbG8=",
      mimetype: "image/jpeg",
      text: "Look!",
    });
  });

  it("sends a document with a filename", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-4" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage({
      token: "t",
      to: "5511999999999",
      kind: "document",
      fileBase64: "ZG9jdW1lbnQ=",
      mimetype: "application/pdf",
      filename: "invoice.pdf",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999999999",
      type: "document",
      file: "ZG9jdW1lbnQ=",
      mimetype: "application/pdf",
      docName: "invoice.pdf",
    });
  });

  it("does not send docName for non-document kinds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-5" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage({
      token: "t",
      to: "5511999999999",
      kind: "audio",
      fileBase64: "YXVkaW8=",
      mimetype: "audio/ogg",
      filename: "ignored.ogg",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).docName).toBeUndefined();
  });

  it("sends a recorded voice note as ptt with no caption", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-ptt" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage({
      token: "t",
      to: "5511999999999",
      kind: "audio",
      fileBase64: "b3B1cw==",
      mimetype: "audio/ogg",
      caption: "ignored for ptt",
      asVoiceNote: true,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/send/media");
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999999999",
      type: "ptt",
      file: "b3B1cw==",
      mimetype: "audio/ogg",
    });
  });

  it("sends audio as an ordinary attachment when asVoiceNote is absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-audio" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage({
      token: "t",
      to: "5511999999999",
      kind: "audio",
      fileBase64: "YXVkaW8=",
      mimetype: "audio/mpeg",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).type).toBe("audio");
  });

  it("replies to a specific message when sending media", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { messageid: "wamid-6" }));
    vi.stubGlobal("fetch", fetchMock);

    await sendMediaMessage({
      token: "t",
      to: "5511999999999",
      kind: "video",
      fileBase64: "dmlkZW8=",
      mimetype: "video/mp4",
      replyToMessageId: "orig-id",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).replyid).toBe("orig-id");
  });

  it("rejects an empty fileBase64 before contacting the gateway", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendMediaMessage({
        token: "t",
        to: "5511999999999",
        kind: "image",
        fileBase64: "",
        mimetype: "image/jpeg",
      }),
    ).rejects.toThrow(/requires fileBase64/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendReactionMessage", () => {
  beforeEach(() => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends an emoji reaction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await sendReactionMessage({
      token: "t",
      to: "5511999999999",
      targetMessageId: "orig-id",
      emoji: "👍",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/message/react");
    expect(JSON.parse(init.body)).toEqual({
      number: "5511999999999",
      id: "orig-id",
      text: "👍",
    });
  });

  it("sends an empty text to remove a reaction", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await sendReactionMessage({
      token: "t",
      to: "5511999999999",
      targetMessageId: "orig-id",
      emoji: "",
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body).text).toBe("");
  });
});

describe("downloadMessageMedia", () => {
  beforeEach(() => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("resolves a fileURL and mimetype, requesting the link (not base64)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        fileURL: "https://gateway.example.com/files/abc.jpg",
        mimetype: "image/jpeg",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadMessageMedia({
      token: "t",
      messageId: "msg-1",
    });

    expect(result).toEqual({
      fileUrl: "https://gateway.example.com/files/abc.jpg",
      mimeType: "image/jpeg",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/message/download");
    expect(JSON.parse(init.body)).toEqual({
      id: "msg-1",
      return_link: true,
      return_base64: false,
    });
  });

  it("defaults mimeType when the gateway omits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(200, { fileURL: "https://gateway.example.com/f" }),
        ),
    );

    const result = await downloadMessageMedia({ token: "t", messageId: "m" });
    expect(result.mimeType).toBe("application/octet-stream");
  });

  it("throws when the gateway returns no fileURL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {})));

    await expect(
      downloadMessageMedia({ token: "t", messageId: "msg-1" }),
    ).rejects.toThrow(/did not return a fileURL/);
  });
});

describe("assertMediaWithinInlineLimit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("defaults the limit to 16 MB when unset", () => {
    expect(maxInlineMediaBytes()).toBe(16 * 1024 * 1024);
  });

  it("honours UAZAPI_MAX_INLINE_MEDIA_BYTES when set to a valid number", () => {
    vi.stubEnv("UAZAPI_MAX_INLINE_MEDIA_BYTES", "1024");
    expect(maxInlineMediaBytes()).toBe(1024);
  });

  it("falls back to the default on an invalid value", () => {
    vi.stubEnv("UAZAPI_MAX_INLINE_MEDIA_BYTES", "not-a-number");
    expect(maxInlineMediaBytes()).toBe(16 * 1024 * 1024);
  });

  it("allows a buffer exactly at the limit", () => {
    vi.stubEnv("UAZAPI_MAX_INLINE_MEDIA_BYTES", "10");
    expect(() =>
      assertMediaWithinInlineLimit(new Uint8Array(10)),
    ).not.toThrow();
  });

  it("throws MediaTooLargeError for a buffer one byte over the limit, without calling fetch", () => {
    vi.stubEnv("UAZAPI_MAX_INLINE_MEDIA_BYTES", "10");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      assertMediaWithinInlineLimit(new Uint8Array(11));
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(MediaTooLargeError);
    expect((caught as MediaTooLargeError).actualBytes).toBe(11);
    expect((caught as MediaTooLargeError).maxBytes).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
