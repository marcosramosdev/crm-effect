import { ProvisioningForm } from "@/components/admin/provisioning-form";
import { MetaAccountsPanel, type AccountMetaRow } from "@/components/admin/meta-accounts-panel";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";

// This page has no dynamic Next.js API (no cookies()/headers() call —
// the auth check already happened in middleware), so without this it
// gets prerendered once at build time and the account list/counters go
// stale until the next deploy instead of reflecting live rows.
export const dynamic = "force-dynamic";

// The /admin guard already ran in middleware.ts (PLATFORM_ADMINS) —
// this page assumes it only ever renders for a listed operator. Reads
// through the service-role client, like provisioning: an operator has
// no membership in the accounts being listed, so the accounts RLS
// policies would otherwise return nothing (design.md D7).
async function loadAccountMetaRows(): Promise<AccountMetaRow[]> {
  const db = supabaseAdmin();

  const { data: accounts } = await db
    .from("accounts")
    .select(
      "id, name, meta_dataset_id, meta_access_token, meta_page_id, meta_event_name, meta_test_event_code, meta_send_ph",
    )
    .order("name");

  const { data: events } = await db
    .from("meta_capi_events")
    .select("account_id, status")
    .in("status", ["pending", "unconfigured"]);

  const counts = new Map<string, { pending: number; unconfigured: number }>();
  for (const row of events ?? []) {
    const c = counts.get(row.account_id) ?? { pending: 0, unconfigured: 0 };
    if (row.status === "pending") c.pending++;
    else if (row.status === "unconfigured") c.unconfigured++;
    counts.set(row.account_id, c);
  }

  return (accounts ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    metaDatasetId: (a.meta_dataset_id as string | null) ?? null,
    // Never the ciphertext itself — only whether one is set (provisioning
    // spec.md, "Credentials are absent from client responses").
    hasAccessToken: Boolean(a.meta_access_token),
    metaPageId: (a.meta_page_id as string | null) ?? null,
    metaEventName: a.meta_event_name as string,
    metaTestEventCode: (a.meta_test_event_code as string | null) ?? null,
    metaSendPh: Boolean(a.meta_send_ph),
    pendingCount: counts.get(a.id as string)?.pending ?? 0,
    unconfiguredCount: counts.get(a.id as string)?.unconfigured ?? 0,
  }));
}

export default async function AdminPage() {
  const accounts = await loadAccountMetaRows();

  return (
    <div className="bg-background flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-xl flex-col gap-8">
        <ProvisioningForm />
        <MetaAccountsPanel accounts={accounts} />
      </div>
    </div>
  );
}
