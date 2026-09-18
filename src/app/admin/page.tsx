import { ProvisioningForm } from "@/components/admin/provisioning-form";
import { AccountList } from "@/components/admin/account-list";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";
import {
  type AccountMetaRow,
  type ConnectionState,
  type ConversionCounts,
  type ConversionStatus,
} from "@/lib/admin/account-status";

// This page has no dynamic Next.js API (no cookies()/headers() call —
// the auth check already happened in middleware), so without this it
// gets prerendered once at build time and the account list/counters go
// stale until the next deploy instead of reflecting live rows.
export const dynamic = "force-dynamic";

// The /admin guard already ran in middleware.ts (PLATFORM_ADMINS) —
// this page assumes it only ever renders for a listed operator. Reads
// through the service-role client, like provisioning: an operator has
// no membership in the accounts being listed, so the accounts RLS
// policies would otherwise return nothing (design.md D7 of
// meta-capi-qualified-lead).
async function loadAccountRows(): Promise<AccountMetaRow[]> {
  const db = supabaseAdmin();

  const { data: accounts } = await db
    .from("accounts")
    .select(
      "id, name, meta_dataset_id, meta_access_token, meta_page_id, meta_event_name, meta_test_event_code, meta_send_ph, deactivated_at",
    )
    .order("name");

  // The connection state as the gateway last reported it. The webhook
  // writes this column on every connection callback, so it tracks the
  // gateway without the console probing it — rendering a list must not
  // depend on an external service being reachable (design.md D2).
  const { data: configs } = await db
    .from("whatsapp_config")
    .select("account_id, connection_state, paired_phone, paired_at");

  const connection = new Map(
    (configs ?? []).map((c) => [
      c.account_id as string,
      {
        state: (c.connection_state as ConnectionState | null) ?? null,
        phone: (c.paired_phone as string | null) ?? null,
        at: (c.paired_at as string | null) ?? null,
      },
    ]),
  );

  const counts = await loadConversionCounts();

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
    // An account with no whatsapp_config row at all (a provision that
    // failed midway) still belongs in the list — it reads as not
    // connected rather than disappearing.
    deactivatedAt: (a.deactivated_at as string | null) ?? null,
    connectionState: connection.get(a.id as string)?.state ?? null,
    pairedPhone: connection.get(a.id as string)?.phone ?? null,
    pairedAt: connection.get(a.id as string)?.at ?? null,
    counts: counts.get(a.id as string) ?? {},
  }));
}

/**
 * Every delivery state, counted per account.
 *
 * ponytail: counts rows in the process because supabase-js has no
 * GROUP BY; move to an RPC doing the grouping in SQL if
 * meta_capi_events passes ~10k rows (design.md D3).
 */
export async function loadConversionCounts(): Promise<Map<string, ConversionCounts>> {
  const { data: events } = await supabaseAdmin()
    .from("meta_capi_events")
    .select("account_id, status");

  const counts = new Map<string, ConversionCounts>();
  for (const row of events ?? []) {
    const accountId = row.account_id as string;
    const status = row.status as ConversionStatus;
    const current = counts.get(accountId) ?? {};
    current[status] = (current[status] ?? 0) + 1;
    counts.set(accountId, current);
  }
  return counts;
}

export default async function AdminPage() {
  const accounts = await loadAccountRows();

  return (
    <div className="bg-background flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <ProvisioningForm />
        <AccountList accounts={accounts} />
      </div>
    </div>
  );
}
