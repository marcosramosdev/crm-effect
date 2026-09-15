import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UazapiError, uazapiAdminFetch, uazapiFetch } from "./uazapi-client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("uazapiFetch / uazapiAdminFetch", () => {
  beforeEach(() => {
    vi.stubEnv("UAZAPI_BASE_URL", "https://gateway.example.com");
    vi.stubEnv("UAZAPI_ADMIN_TOKEN", "admin-secret");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the instance token header and returns the parsed body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await uazapiFetch<{ ok: boolean }>({
      path: "/send/text",
      token: "instance-token",
      body: { number: "123", text: "hi" },
    });

    expect(result).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://gateway.example.com/send/text");
    expect(init.headers.token).toBe("instance-token");
    expect(init.headers.admintoken).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ number: "123", text: "hi" });
  });

  it("sends the admin token header for admin-scoped calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { instance: "i1" }));
    vi.stubGlobal("fetch", fetchMock);

    await uazapiAdminFetch({ path: "/instance/create", body: { name: "a" } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.admintoken).toBe("admin-secret");
    expect(init.headers.token).toBeUndefined();
  });

  it("treats an empty 200 body as an empty object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 200 })),
    );

    const result = await uazapiFetch({
      path: "/instance/disconnect",
      token: "t",
    });
    expect(result).toEqual({});
  });

  it.each([
    [401, "unauthenticated"],
    [403, "unauthenticated"],
    [429, "rate_limited"],
    [400, "invalid_request"],
    [422, "invalid_request"],
    [500, "gateway_error"],
    [503, "gateway_error"],
  ] as const)("maps HTTP %d onto code %s", async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(status, { error: "boom" })),
    );

    const err = await uazapiFetch({ path: "/x", token: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(UazapiError);
    expect((err as UazapiError).code).toBe(code);
    expect((err as UazapiError).status).toBe(status);
    expect((err as UazapiError).message).toBe("boom");
  });

  it("falls back to a status-line message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>gateway down</html>", { status: 502 }),
        ),
    );

    const err = await uazapiFetch({ path: "/x", token: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(UazapiError);
    expect((err as UazapiError).code).toBe("gateway_error");
    expect((err as UazapiError).message).toContain("gateway down");
  });

  it("wraps a network failure (fetch throwing) as gateway_error with no status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    );

    const err = await uazapiFetch({ path: "/x", token: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(UazapiError);
    expect((err as UazapiError).code).toBe("gateway_error");
    expect((err as UazapiError).status).toBeUndefined();
    expect((err as UazapiError).message).toContain("ECONNREFUSED");
  });

  it("throws not_configured when UAZAPI_BASE_URL is missing", async () => {
    vi.stubEnv("UAZAPI_BASE_URL", "");
    const err = await uazapiFetch({ path: "/x", token: "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(UazapiError);
    expect((err as UazapiError).code).toBe("not_configured");
    expect((err as UazapiError).message).toContain("UAZAPI_BASE_URL");
  });

  it("throws not_configured when UAZAPI_ADMIN_TOKEN is missing", async () => {
    vi.stubEnv("UAZAPI_ADMIN_TOKEN", "");
    const err = await uazapiAdminFetch({ path: "/instance/create" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(UazapiError);
    expect((err as UazapiError).code).toBe("not_configured");
    expect((err as UazapiError).message).toContain("UAZAPI_ADMIN_TOKEN");
  });
});
