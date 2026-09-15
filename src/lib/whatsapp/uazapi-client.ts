/**
 * UAZAPI transport primitives.
 *
 * Every UAZAPI call in the app goes through `uazapiFetch` (instance
 * scoped, `token` header) or `uazapiAdminFetch` (server scoped,
 * `admintoken` header). Nothing above this module should know the
 * gateway's base URL, its header names, or its error envelope.
 *
 * Why a typed error instead of a bare `Error`: the callers need to
 * behave differently per failure class — a broadcast backs off on a
 * rate limit but marks a recipient failed on an invalid one, and the
 * settings UI has to tell "your instance token is stale" apart from
 * "the gateway is down". Matching on message strings is how the Meta
 * client got that wrong repeatedly, so the class carries a machine
 * `code` instead.
 *
 * Like the Meta client this replaces, every function takes a single
 * options object. Positional args were a repeated source of swapped
 * `(token, id)` bugs.
 */

/** Failure classes a caller can branch on. */
export type UazapiErrorCode =
  | "not_configured"
  | "unauthenticated"
  | "rate_limited"
  | "invalid_request"
  | "gateway_error";

export class UazapiError extends Error {
  readonly code: UazapiErrorCode;
  /** Upstream HTTP status, absent when the call never left the process. */
  readonly status?: number;

  constructor(code: UazapiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "UazapiError";
    this.code = code;
    this.status = status;
  }
}

/**
 * Base URL of the UAZAPI server, without a trailing slash.
 *
 * Read at call time rather than module load so tests (and a build with
 * no env) don't blow up on import, and so a missing value surfaces as a
 * typed `not_configured` error the route can render.
 */
export function uazapiBaseUrl(): string {
  const raw = process.env.UAZAPI_BASE_URL?.trim();
  if (!raw) {
    throw new UazapiError(
      "not_configured",
      "UAZAPI_BASE_URL is not set — add it to your environment to connect WhatsApp.",
    );
  }
  return raw.replace(/\/+$/, "");
}

/**
 * Server-wide admin credential. Only instance provisioning needs it;
 * it is never persisted and never leaves the server.
 */
export function uazapiAdminToken(): string {
  const raw = process.env.UAZAPI_ADMIN_TOKEN?.trim();
  if (!raw) {
    throw new UazapiError(
      "not_configured",
      "UAZAPI_ADMIN_TOKEN is not set — add it to your environment to create a WhatsApp instance.",
    );
  }
  return raw;
}

/**
 * UAZAPI reports failures as `{ "error": "..." }`. Some paths return a
 * bare string or an HTML error page from a proxy in front of the
 * gateway, so parsing is best-effort and always falls back to a status
 * line the operator can act on.
 */
async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const text = await response.text();
    if (!text) return fallback;
    try {
      const data = JSON.parse(text) as { error?: unknown; message?: unknown };
      const detail = data.error ?? data.message;
      if (typeof detail === "string" && detail.trim()) return detail.trim();
    } catch {
      // Not JSON — fall through to the raw body below.
    }
    // Cap the raw body: an HTML error page would otherwise end up in a
    // user-facing toast and in the logs in full.
    return text.slice(0, 300);
  } catch {
    return fallback;
  }
}

function classify(status: number): UazapiErrorCode {
  if (status === 401 || status === 403) return "unauthenticated";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid_request";
  return "gateway_error";
}

interface RequestArgs {
  /** Path beginning with a slash, e.g. `/send/text`. */
  path: string;
  /** Defaults to POST — most of the UAZAPI surface is POST. */
  method?: "GET" | "POST" | "DELETE";
  /** JSON request body. Omitted for GET. */
  body?: unknown;
  /** Auth header name and value. */
  authHeader: "token" | "admintoken";
  authValue: string;
}

async function request<T>(args: RequestArgs): Promise<T> {
  const { path, method = "POST", body, authHeader, authValue } = args;

  const headers: Record<string, string> = { [authHeader]: authValue };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // Resolved outside the try block below: a `not_configured` error must
  // propagate as-is, not get caught and rewrapped as `gateway_error` by
  // the network-failure handler around the fetch call.
  const url = `${uazapiBaseUrl()}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Gateway responses are never cacheable — they describe live
      // WhatsApp state.
      cache: "no-store",
    });
  } catch (err) {
    // DNS failure, connection refused, TLS error, abort. The gateway
    // never answered, so nothing was sent.
    const detail = err instanceof Error ? err.message : String(err);
    throw new UazapiError(
      "gateway_error",
      `Could not reach the WhatsApp gateway: ${detail}`,
    );
  }

  if (!response.ok) {
    const message = await readErrorMessage(
      response,
      `WhatsApp gateway error: ${response.status}`,
    );
    throw new UazapiError(classify(response.status), message, response.status);
  }

  // A few endpoints (disconnect, webhook registration) answer 200 with
  // an empty body; treat that as an empty object rather than throwing
  // on the JSON parse.
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UazapiError(
      "gateway_error",
      "WhatsApp gateway returned a malformed JSON response",
    );
  }
}

/** Instance-scoped call — authenticated with the instance token. */
export async function uazapiFetch<T>(args: {
  path: string;
  token: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
}): Promise<T> {
  return request<T>({
    path: args.path,
    method: args.method,
    body: args.body,
    authHeader: "token",
    authValue: args.token,
  });
}

/** Server-scoped call — authenticated with the admin token. */
export async function uazapiAdminFetch<T>(args: {
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
}): Promise<T> {
  return request<T>({
    path: args.path,
    method: args.method,
    body: args.body,
    authHeader: "admintoken",
    authValue: uazapiAdminToken(),
  });
}
