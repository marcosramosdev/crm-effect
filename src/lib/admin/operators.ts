// ============================================================
// The platform-operator register: recorded operators plus every
// seed address (platform-admin-profiles design.md D3/D4).
//
// A seed address always wins over a conflicting row — resolvePlatformOperator
// resolves it as manager unconditionally — so the register shows it the
// same way rather than listing two conflicting truths for one address.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getSeedOperatorEmails,
  type PlatformOperatorRole,
} from "@/lib/provisioning/platform-admins";

export interface OperatorRow {
  /** `null` only for a seed address that has never signed up. */
  userId: string | null;
  email: string;
  /** `null` for a seed address with no row of its own. */
  fullName: string | null;
  role: PlatformOperatorRole;
  seeded: boolean;
  createdByName: string | null;
  createdAt: string | null;
}

interface OperatorTableRow {
  user_id: string;
  email: string;
  full_name: string;
  role: PlatformOperatorRole;
  created_by: string | null;
  created_at: string;
}

/** Reads through the service-role client — an operator has no client-account
 *  membership, and the table's only RLS policy is "read your own row". */
export async function listOperators(db: SupabaseClient): Promise<OperatorRow[]> {
  const seedEmails = getSeedOperatorEmails();
  const seedSet = new Set(seedEmails);

  const { data } = await db
    .from("platform_operators")
    .select("user_id, email, full_name, role, created_by, created_at")
    .order("created_at", { ascending: true });
  const rows = (data ?? []) as OperatorTableRow[];

  const nameById = new Map(rows.map((r) => [r.user_id, r.full_name]));

  const operators: OperatorRow[] = [];
  for (const r of rows) {
    if (seedSet.has(r.email.toLowerCase())) continue; // shown once, below
    operators.push({
      userId: r.user_id,
      email: r.email,
      fullName: r.full_name,
      role: r.role,
      seeded: false,
      createdByName: r.created_by ? (nameById.get(r.created_by) ?? null) : null,
      createdAt: r.created_at,
    });
  }

  for (const email of seedEmails) {
    const row = rows.find((r) => r.email.toLowerCase() === email);
    operators.push({
      userId: row?.user_id ?? null,
      email,
      fullName: row?.full_name ?? null,
      role: "manager",
      seeded: true,
      createdByName: null,
      createdAt: null,
    });
  }

  return operators;
}
