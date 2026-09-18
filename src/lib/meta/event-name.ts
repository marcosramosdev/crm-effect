// ============================================================
// The conversion event name, validated in one place.
//
// Two surfaces write this column — the provisioning form and the
// per-account advertising form — and the spec requires them to reject
// exactly the same values ("Same event name is rejected in both
// places", admin-console spec.md). A second copy of the regex is the
// divergence that requirement exists to catch (design.md D10).
// ============================================================

/** Matches common Meta event names (Lead, Purchase, CompleteRegistration, …). */
const EVENT_NAME_RE = /^[A-Za-z0-9_]+$/;

/** The column default (migration 048) — what an account reports under when nobody chooses. */
export const DEFAULT_META_EVENT_NAME = "Lead";

export const META_EVENT_NAME_ERROR =
  "meta_event_name must be a non-empty token of letters, digits, or underscore";

/**
 * `{ value }` when the name is usable, `{ error }` when it is not.
 * A non-string is treated as absent, so callers can hand this whatever
 * arrived in a request body.
 */
export function validateMetaEventName(
  value: unknown,
): { value: string; error?: undefined } | { value?: undefined; error: string } {
  const name = typeof value === "string" ? value.trim() : "";
  if (!EVENT_NAME_RE.test(name)) return { error: META_EVENT_NAME_ERROR };
  return { value: name };
}
