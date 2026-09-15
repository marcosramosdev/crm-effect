import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  downloadMessageMedia: vi.fn(),
  mirrorInboundMedia: vi.fn(),
}));

vi.mock("./uazapi", () => ({
  downloadMessageMedia: h.downloadMessageMedia,
}));
vi.mock("./mirror-inbound-media", () => ({
  mirrorInboundMedia: h.mirrorInboundMedia,
}));
vi.mock("./encryption", () => ({
  decrypt: (v: string) => `decrypted:${v}`,
}));

import {
  resolveInboundMedia,
  mapMediaKind,
  normalizeMessageType,
} from "./inbound-media";

const BASE = {
  storage: {} as never,
  accountId: "acc-1",
  messageId: "msg-1",
  encryptedInstanceToken: "enc-token",
  mirrorEnabled: true,
};

describe("normalizeMessageType", () => {
  it("strips the proto-style Message suffix and lower-cases", () => {
    expect(normalizeMessageType("ImageMessage")).toBe("image");
    expect(normalizeMessageType("PTTMessage")).toBe("ptt");
    expect(normalizeMessageType("LocationMessage")).toBe("location");
    expect(normalizeMessageType("ExtendedTextMessage")).toBe("extendedtext");
    expect(normalizeMessageType("DocumentWithCaptionMessage")).toBe(
      "documentwithcaption",
    );
  });

  it("passes bare tokens and conversation through untouched", () => {
    expect(normalizeMessageType("image")).toBe("image");
    expect(normalizeMessageType("Conversation")).toBe("conversation");
    expect(normalizeMessageType("ptt")).toBe("ptt");
  });

  it("handles empty / nullish input", () => {
    expect(normalizeMessageType("")).toBe("");
    expect(normalizeMessageType(undefined)).toBe("");
    expect(normalizeMessageType(null)).toBe("");
  });
});

describe("mapMediaKind", () => {
  it("maps known UAZAPI media types (bare tokens)", () => {
    expect(mapMediaKind("image")).toBe("image");
    expect(mapMediaKind("sticker")).toBe("image");
    expect(mapMediaKind("video")).toBe("video");
    expect(mapMediaKind("document")).toBe("document");
    expect(mapMediaKind("audio")).toBe("audio");
    expect(mapMediaKind("ptt")).toBe("audio");
  });

  it("maps the gateway proto-style spellings", () => {
    expect(mapMediaKind("ImageMessage")).toBe("image");
    expect(mapMediaKind("AudioMessage")).toBe("audio");
    expect(mapMediaKind("PttMessage")).toBe("audio");
    expect(mapMediaKind("VideoMessage")).toBe("video");
    expect(mapMediaKind("DocumentMessage")).toBe("document");
    expect(mapMediaKind("DocumentWithCaptionMessage")).toBe("document");
    expect(mapMediaKind("StickerMessage")).toBe("image");
  });

  it("is case-insensitive", () => {
    expect(mapMediaKind("IMAGE")).toBe("image");
    expect(mapMediaKind("imagemessage")).toBe("image");
  });

  it("returns null for text and unknown types", () => {
    expect(mapMediaKind("text")).toBeNull();
    expect(mapMediaKind("chat")).toBeNull();
    expect(mapMediaKind("conversation")).toBeNull();
    expect(mapMediaKind("ExtendedTextMessage")).toBeNull();
    expect(mapMediaKind("LocationMessage")).toBeNull();
    expect(mapMediaKind(undefined)).toBeNull();
    expect(mapMediaKind(null)).toBeNull();
  });
});

describe("resolveInboundMedia", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    h.downloadMessageMedia.mockReset();
    h.mirrorInboundMedia.mockReset();
  });

  it("success path: downloads and mirrors, returning the durable URL", async () => {
    h.downloadMessageMedia.mockResolvedValue({
      fileUrl: "https://gateway.test/file.jpg",
      mimeType: "image/jpeg",
    });
    h.mirrorInboundMedia.mockResolvedValue("https://cdn.test/mirrored.jpg");

    const result = await resolveInboundMedia(BASE);

    expect(h.downloadMessageMedia).toHaveBeenCalledWith({
      token: "decrypted:enc-token",
      messageId: "msg-1",
    });
    expect(h.mirrorInboundMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acc-1",
        mediaId: "msg-1",
        downloadUrl: "https://gateway.test/file.jpg",
        mimeType: "image/jpeg",
      }),
    );
    expect(result).toEqual({
      mediaUrl: "https://cdn.test/mirrored.jpg",
      mediaType: "image/jpeg",
    });
  });

  it("download failure: no URL at all, media marked unavailable, never mirrors", async () => {
    h.downloadMessageMedia.mockRejectedValue(new Error("gateway unreachable"));

    const result = await resolveInboundMedia(BASE);

    expect(result).toEqual({ mediaUrl: null, mediaType: null });
    expect(h.mirrorInboundMedia).not.toHaveBeenCalled();
  });

  it("upload failure: falls back to the gateway file URL", async () => {
    h.downloadMessageMedia.mockResolvedValue({
      fileUrl: "https://gateway.test/file.pdf",
      mimeType: "application/pdf",
    });
    // mirrorInboundMedia's own contract: null means it failed internally
    // (download-inside-mirror or Storage upload) and already logged why.
    h.mirrorInboundMedia.mockResolvedValue(null);

    const result = await resolveInboundMedia(BASE);

    expect(result).toEqual({
      mediaUrl: "https://gateway.test/file.pdf",
      mediaType: "application/pdf",
    });
  });

  it("skips the mirror entirely when the account opted out", async () => {
    h.downloadMessageMedia.mockResolvedValue({
      fileUrl: "https://gateway.test/file.jpg",
      mimeType: "image/jpeg",
    });

    const result = await resolveInboundMedia({ ...BASE, mirrorEnabled: false });

    expect(h.mirrorInboundMedia).not.toHaveBeenCalled();
    expect(result).toEqual({
      mediaUrl: "https://gateway.test/file.jpg",
      mediaType: "image/jpeg",
    });
  });

  it("returns null without calling the gateway when no instance token is on record", async () => {
    const result = await resolveInboundMedia({
      ...BASE,
      encryptedInstanceToken: null,
    });

    expect(result).toEqual({ mediaUrl: null, mediaType: null });
    expect(h.downloadMessageMedia).not.toHaveBeenCalled();
  });
});
