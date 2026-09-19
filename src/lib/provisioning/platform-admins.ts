import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Platform operator roles (platform-admin-profiles design.md D1).
 * Deliberately not `AccountRole` from `@/lib/auth/roles` — that enum
 * already owns the value `"admin"` for a role inside a *client*
 * account, an entirely different thing. Keeping the two vocabularies
 * as separate types is what keeps the wrong one from being used.
 */
export type PlatformOperatorRole = "manager" | "admin";

export interface PlatformOperator {
  role: PlatformOperatorRole;
  /** True when this resolved from `PLATFORM_ADMINS`, not a table row. */
  seeded: boolean;
}

/**
 * Every address `PLATFORM_ADMINS` seeds, lower-cased and de-duplicated.
 * Unset or empty yields no addresses — never treat a misconfigured
 * deployment as wide open.
 */
export function getSeedOperatorEmails(): string[] {
  const raw = process.env.PLATFORM_ADMINS;
  if (!raw) return [];
  const emails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(emails));
}

/** Whether `email` is one of the deployment's seed addresses — a manager
 *  regardless of whatever row exists for it (design.md D3). */
export function isSeededOperatorEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  return getSeedOperatorEmails().includes(target);
}

/**
 * Resolve whether `user` is a platform operator, and with which role.
 *
 * The environment seed is checked first, synchronously, with no query —
 * the addresses that bootstrap a deployment must resolve even when the
 * database is unreachable (design.md D3, Risks). Only when the seed
 * doesn't match does this read the caller's own `platform_operators`
 * row, through `supabase` (RLS-scoped to the caller under their own
 * session — migration 051, "read your own row").
 *
 * Every call site re-runs this on the server for every action, exactly
 * as the old `isPlatformAdmin` was re-checked — nothing here caches.
 */
export async function resolvePlatformOperator(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null } | null | undefined,
): Promise<PlatformOperator | null> {
  if (!user) return null;

  if (isSeededOperatorEmail(user.email)) {
    return { role: "manager", seeded: true };
  }

  try {
    const { data, error } = await supabase
      .from("platform_operators")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data?.role) return null;
    return { role: data.role as PlatformOperatorRole, seeded: false };
  } catch {
    // Table unreachable and the address isn't seeded — deny rather than
    // cache or guess (design.md D3, Risks: only the seed survives an outage).
    return null;
  }
}

/** The one manager-only gate (tasks.md 3.1), shared by every route and
 *  page that needs it. */
export function isManager(
  operator: PlatformOperator | null,
): operator is PlatformOperator & { role: "manager" } {
  return operator?.role === "manager";
}
