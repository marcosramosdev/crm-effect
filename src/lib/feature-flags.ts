/**
 * Deployment-wide feature switches.
 *
 * These are read from `NEXT_PUBLIC_*` env vars so the same value is
 * available in the browser bundle (nav, dashboard, composer) and on the
 * Edge middleware. They are inlined at build time — flipping one needs a
 * rebuild, which is fine for gating half-built features.
 */

/**
 * Broadcasts, Automations, and Flows are incomplete. They stay in the
 * codebase but are hidden from operators and their routes are blocked
 * unless this is explicitly turned on. Any value other than the literal
 * string "true" counts as off, so a deployment that sets nothing exposes
 * none of them. The AI assistant (`/agents`) is finished and is never
 * part of this set — it's reachable regardless of this switch.
 */
export const INCOMPLETE_FEATURES_ENABLED =
  process.env.NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED === "true";

/**
 * Route prefixes owned by the incomplete features above. A pathname that
 * equals one of these or is nested under it (e.g. `/broadcasts/new`) is
 * gated together with the rest of the set.
 */
export const GATED_FEATURE_PREFIXES = [
  "/broadcasts",
  "/automations",
  "/flows",
] as const;

/** True when `pathname` falls under a gated feature route. */
export function isGatedFeaturePath(pathname: string): boolean {
  return GATED_FEATURE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
