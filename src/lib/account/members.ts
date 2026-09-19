import type { AccountMember } from "@/types";

/**
 * Fetch the current account's members from the API (which applies the
 * email-visibility rules — agents/viewers don't see emails). Best-effort:
 * returns `[]` on any error or on an older deployment without the
 * endpoint, so callers can fall back to a queue-only / raw-id picker.
 *
 * Client-side only (uses `fetch` against the relative API route).
 */
export async function fetchAccountMembers(): Promise<AccountMember[]> {
  try {
    const res = await fetch("/api/account/members", { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { members?: AccountMember[] };
    return json.members ?? [];
  } catch {
    return [];
  }
}

/**
 * Display label for a member: full name → email → `fallback`. Never
 * the raw id — no client-facing picker or label shows an internal
 * identifier (localization spec, "Internal identifiers never reach a
 * client-facing screen"). Takes the fallback text from the caller
 * rather than a hardcoded string because this module isn't React and
 * can't reach the active locale's translations itself.
 *
 * Structural, not `AccountMember`-only, so it also takes a `Profile`
 * (deal assignee, automation agent picker) without forcing every
 * caller onto one shared type.
 */
export function memberLabel(
  m: { full_name?: string | null; email?: string | null },
  fallback: string,
): string {
  return m.full_name || m.email || fallback;
}
