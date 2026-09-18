// ============================================================
// The Meta Graph API, in one place.
//
// This is the only module in the repository that talks to
// graph.facebook.com. It holds the API version, the request wrapper,
// and the classifier that turns Meta's error bodies into the outcomes
// the operator console renders (design.md D4/D5).
//
// The conversion sender of meta-capi-qualified-lead task 8.1 posts to
// the same host with the same version and the same error vocabulary —
// it reuses this module rather than growing a second copy of the
// version string.
// ============================================================

/**
 * Pinned deliberately. When Meta retires this version the request
 * starts failing with Meta's own message, which `meta_error` passes
 * through verbatim — a visible failure that names its own cause
 * (design.md, Risks).
 */
export const META_GRAPH_VERSION = "v23.0";

const META_GRAPH_ORIGIN = "https://graph.facebook.com";

/** Bounded so a slow Meta cannot hold an operator's request open (design.md D4). */
const META_GRAPH_TIMEOUT_MS = 10_000;

/**
 * Why `unreachable` is not a failure like the others: a call that never
 * completed says nothing about whether the credentials are good, and
 * the console must not present it as a rejection (spec, "Meta does not
 * answer").
 */
export type MetaGraphFailureReason =
  | "invalid_token"
  | "business_mismatch"
  | "meta_error"
  | "unreachable";

export interface MetaGraphFailure {
  ok: false;
  reason: MetaGraphFailureReason;
  /**
   * Meta's own wording, or a description of the transport failure.
   * Never empty: the console shows it whenever `reason` is
   * `meta_error`, and an empty string would leave the operator with
   * nothing to act on.
   */
  message: string;
}

export interface MetaGraphSuccess<T> {
  ok: true;
  data: T;
}

export type MetaGraphResult<T> = MetaGraphSuccess<T> | MetaGraphFailure;

interface MetaErrorBody {
  error?: {
    message?: unknown;
    code?: unknown;
    error_subcode?: unknown;
  };
}

/**
 * Meta's error body → the console's three rejection outcomes.
 *
 * `190` is a dead or expired token — the failure mode a token generated
 * in Events Manager reaches when its author loses access. `100` with
 * subcode 33, which Meta also spells `(#803)` in the message, is the
 * token and the dataset living under different Business Managers. Those
 * two are what an operator actually hits (runbook §2.2); everything
 * else keeps Meta's wording rather than hiding behind a generic phrase.
 */
export function classifyMetaError(status: number, body: unknown): MetaGraphFailure {
  const error = (body as MetaErrorBody | null)?.error;
  const code = typeof error?.code === "number" ? error.code : undefined;
  const subcode =
    typeof error?.error_subcode === "number" ? error.error_subcode : undefined;
  const raw = typeof error?.message === "string" ? error.message.trim() : "";
  // Meta omits `message` on some rejections; HTTP status is then the
  // only thing left to report, and reporting nothing is not an option.
  const message = raw || `Meta rejected the request (HTTP ${status})`;

  if (code === 190) return { ok: false, reason: "invalid_token", message };
  if (code === 100 && (subcode === 33 || message.includes("#803"))) {
    return { ok: false, reason: "business_mismatch", message };
  }
  return { ok: false, reason: "meta_error", message };
}

export interface MetaGraphGetArgs {
  /** Path under the version, e.g. a dataset id. Encoded into a single segment. */
  path: string;
  /** Query string parameters, e.g. `{ fields: "id,name" }`. */
  params?: Record<string, string>;
  /** Plain (decrypted) access token, sent as a bearer credential. */
  token: string;
}

/**
 * One GET against the Graph API. The host is a literal and `path` is
 * URL-encoded into a single segment, so a caller-supplied value cannot
 * redirect the request anywhere else.
 */
export async function metaGraphGet<T>(args: MetaGraphGetArgs): Promise<MetaGraphResult<T>> {
  const url = new URL(
    `/${META_GRAPH_VERSION}/${encodeURIComponent(args.path)}`,
    META_GRAPH_ORIGIN,
  );
  for (const [key, value] of Object.entries(args.params ?? {})) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(META_GRAPH_TIMEOUT_MS),
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: "unreachable",
      message: cause || "The request to Meta did not complete",
    };
  }

  const body = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) return classifyMetaError(response.status, body);

  // A 200 whose body is not an object is not a usable answer either —
  // treated as an unfinished check rather than as a confirmation.
  if (body === null || typeof body !== "object") {
    return {
      ok: false,
      reason: "unreachable",
      message: "Meta returned a response that could not be read",
    };
  }

  return { ok: true, data: body as T };
}
