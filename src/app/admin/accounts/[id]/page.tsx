import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ChevronLeft } from "lucide-react";

import { AccountMetaForm } from "@/components/admin/account-meta-form";
import { AccountSetupState } from "@/components/admin/account-setup-state";
import {
  AccountConversions,
  type ConversionRow,
} from "@/components/admin/account-conversions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { supabaseAdmin } from "@/lib/provisioning/admin-client";
import {
  type AccountMetaRow,
  type ConnectionState,
  type ConversionCounts,
  type ConversionStatus,
} from "@/lib/admin/account-status";

export const dynamic = "force-dynamic";

/** A long Meta error is shortened for display; the full text stays in the row's title. */
const ERROR_MAX = 120;

/**
 * One account's operator page.
 *
 * Reads through the service-role client for the same reason the list
 * does. Every select list here is explicit and omits the token
 * ciphertext, the contact's phone number and the ad click id — the
 * values that must not reach the browser are not fetched at all, so no
 * later template change can leak them (design.md D8).
 *
 * The /admin prefix guard in src/middleware.ts covers this path, so a
 * non-operator never reaches it.
 */
async function loadAccount(accountId: string) {
  const db = supabaseAdmin();

  const { data: account } = await db
    .from("accounts")
    .select(
      "id, name, meta_dataset_id, meta_access_token, meta_page_id, meta_event_name, meta_test_event_code, meta_send_ph",
    )
    .eq("id", accountId)
    .maybeSingle();

  if (!account) return null;

  const { data: config } = await db
    .from("whatsapp_config")
    .select("connection_state, paired_phone, paired_at")
    .eq("account_id", accountId)
    .maybeSingle();

  const { data: events } = await db
    .from("meta_capi_events")
    .select("id, status, event_time, attempts, last_error, created_at, contacts(name)")
    .eq("account_id", accountId)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: allStatuses } = await db
    .from("meta_capi_events")
    .select("status")
    .eq("account_id", accountId);

  const counts: ConversionCounts = {};
  for (const row of allStatuses ?? []) {
    const status = row.status as ConversionStatus;
    counts[status] = (counts[status] ?? 0) + 1;
  }

  // Whether any ad click has ever landed on this account's contacts —
  // one of the five conditions the setup state derives. `head: true`
  // fetches no rows, so no contact data is read to answer it.
  const { count: adContacts } = await db
    .from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .not("ctwa_clid", "is", null);

  const row: AccountMetaRow = {
    id: account.id as string,
    name: account.name as string,
    metaDatasetId: (account.meta_dataset_id as string | null) ?? null,
    hasAccessToken: Boolean(account.meta_access_token),
    metaPageId: (account.meta_page_id as string | null) ?? null,
    metaEventName: account.meta_event_name as string,
    metaTestEventCode: (account.meta_test_event_code as string | null) ?? null,
    metaSendPh: Boolean(account.meta_send_ph),
    connectionState: (config?.connection_state as ConnectionState | null) ?? null,
    pairedPhone: (config?.paired_phone as string | null) ?? null,
    pairedAt: (config?.paired_at as string | null) ?? null,
    counts,
  };

  const conversions: ConversionRow[] = (events ?? []).map((e) => {
    const contact = e.contacts as { name?: string | null } | { name?: string | null }[] | null;
    const name = Array.isArray(contact) ? (contact[0]?.name ?? null) : (contact?.name ?? null);
    const lastError = (e.last_error as string | null) ?? null;
    return {
      id: e.id as string,
      contactName: name,
      status: e.status as ConversionStatus,
      eventTime: e.event_time as string,
      attempts: (e.attempts as number) ?? 0,
      lastError:
        lastError && lastError.length > ERROR_MAX
          ? `${lastError.slice(0, ERROR_MAX)}…`
          : lastError,
    };
  });

  return { row, conversions, hasAdOriginatedContact: (adContacts ?? 0) > 0 };
}

export default async function AdminAccountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loaded = await loadAccount(id);
  if (!loaded) notFound();

  const { row, conversions, hasAdOriginatedContact } = loaded;
  const t = await getTranslations("AdminConsole.accountPage");

  return (
    <div className="bg-background flex min-h-screen justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-8">
        <div>
          <Link
            href="/admin"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ChevronLeft className="size-4" />
            {t("back")}
          </Link>
          <h1 className="text-foreground mt-2 text-2xl font-semibold">{row.name}</h1>
        </div>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">{t("setupTitle")}</CardTitle>
            <CardDescription>{t("setupDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountSetupState
              account={row}
              hasAdOriginatedContact={hasAdOriginatedContact}
            />
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">{t("configTitle")}</CardTitle>
            <CardDescription>{t("configDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountMetaForm account={row} />
          </CardContent>
        </Card>

        <Card className="border-border bg-card">
          <CardHeader>
            <CardTitle className="text-foreground">{t("conversionsTitle")}</CardTitle>
            <CardDescription>{t("conversionsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <AccountConversions rows={conversions} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
