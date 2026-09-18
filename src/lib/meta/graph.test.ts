import { afterEach, describe, expect, it, vi } from "vitest";

import { META_GRAPH_VERSION, classifyMetaError, metaGraphGet } from "./graph";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Bodies as Meta returns them — the shapes tasks.md 1.3 asks for one
// recorded example of per branch.
const DEAD_TOKEN = {
  error: {
    message: "Error validating access token: Session has expired.",
    type: "OAuthException",
    code: 190,
    error_subcode: 463,
  },
};

const BUSINESS_MISMATCH = {
  error: {
    message:
      "(#803) Some of the aliases you requested do not exist: 1234567890",
    type: "OAuthException",
    code: 100,
  },
};

const BUSINESS_MISMATCH_SUBCODE = {
  error: {
    message: "Unsupported get request.",
    type: "GraphMethodException",
    code: 100,
    error_subcode: 33,
  },
};

const UNMAPPED = {
  error: {
    message: "Application request limit reached",
    type: "OAuthException",
    code: 4,
  },
};

describe("classifyMetaError", () => {
  it("reads code 190 as a dead token", () => {
    const failure = classifyMetaError(400, DEAD_TOKEN);
    expect(failure.reason).toBe("invalid_token");
    expect(failure.message).toContain("Session has expired");
  });

  it("reads #803 in the message as a business manager mismatch", () => {
    expect(classifyMetaError(400, BUSINESS_MISMATCH).reason).toBe("business_mismatch");
  });

  it("reads code 100 with subcode 33 as a business manager mismatch", () => {
    expect(classifyMetaError(400, BUSINESS_MISMATCH_SUBCODE).reason).toBe(
      "business_mismatch",
    );
  });

  it("passes an unmapped error through with Meta's own wording", () => {
    const failure = classifyMetaError(400, UNMAPPED);
    expect(failure.reason).toBe("meta_error");
    expect(failure.message).toBe("Application request limit reached");
  });

  // tasks.md 1.4 — an operator must never be handed an empty message.
  it("never returns an empty message", () => {
    for (const body of [null, {}, { error: {} }, { error: { message: "   " } }]) {
      expect(classifyMetaError(500, body).message.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("metaGraphGet", () => {
  it("calls the pinned version on the Graph host with the id as one segment", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) =>
      new Response(JSON.stringify({ id: "42", name: "Clinic dataset" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await metaGraphGet<{ name: string }>({
      path: "42/../evil",
      params: { fields: "id,name" },
      token: "tok",
    });

    expect(result).toEqual({ ok: true, data: { id: "42", name: "Clinic dataset" } });
    const url = new URL(fetchMock.mock.calls[0][0] as unknown as URL);
    expect(url.origin).toBe("https://graph.facebook.com");
    expect(url.pathname).toBe(`/${META_GRAPH_VERSION}/42%2F..%2Fevil`);
    expect(url.searchParams.get("fields")).toBe("id,name");
  });

  it("classifies an error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(DEAD_TOKEN), { status: 400 })),
    );

    const result = await metaGraphGet({ path: "42", token: "tok" });
    expect(result).toMatchObject({ ok: false, reason: "invalid_token" });
  });

  it("reports a timeout as unreachable, not as a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted.", "AbortError");
      }),
    );

    const result = await metaGraphGet({ path: "42", token: "tok" });
    expect(result).toMatchObject({ ok: false, reason: "unreachable" });
    expect((result as { message: string }).message).not.toBe("");
  });
});
