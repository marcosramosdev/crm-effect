"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  classifyAccountMetaStatus,
  visibleConversionCounts,
  type AccountMetaRow,
} from "@/lib/admin/account-status";

// One row per account: the messaging connection, the advertising
// state, the conversion counts. Everything an operator needs to answer
// "is this clinic working?" without opening anything (admin-console
// spec.md, "The console lists every account with its operational
// state"). The row never receives the access token itself — only
// `hasAccessToken`.
//
// Deactivated accounts sit in their own section below the active ones,
// listed rather than hidden ("Deactivated accounts are separated, not
// hidden"). The split happens here, over the rows the page already
// loaded — one query still backs the list (design.md D9).
export function AccountList({ accounts }: { accounts: AccountMetaRow[] }) {
  const t = useTranslations("AdminConsole.accounts");

  const active = accounts.filter((a) => !a.deactivatedAt);
  const deactivated = accounts.filter((a) => a.deactivatedAt);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">{t("sectionTitle")}</CardTitle>
        <CardDescription>{t("sectionDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noAccounts")}</p>
        ) : (
          <>
            {active.map((account) => (
              <AccountRow key={account.id} account={account} />
            ))}

            {deactivated.length > 0 && (
              <div className="space-y-3 pt-4">
                <p className="text-muted-foreground text-xs font-medium uppercase">
                  {t("deactivatedSection", { count: deactivated.length })}
                </p>
                {deactivated.map((account) => (
                  <AccountRow key={account.id} account={account} />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AccountRow({ account }: { account: AccountMetaRow }) {
  const t = useTranslations("AdminConsole.accounts");
  const tm = useTranslations("AdminConsole.metaConfig");

  const { isConfigured, isPartial, isTestMode, isConnected, hasNoConversions } =
    classifyAccountMetaStatus(account);
  const isDeactivated = Boolean(account.deactivatedAt);

  return (
    <Link
      href={`/admin/accounts/${account.id}`}
      className={`border-border hover:bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 ${
        isDeactivated ? "opacity-60" : ""
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground truncate font-medium">{account.name}</span>
          {isDeactivated && (
            <Badge variant="destructive">{t("deactivatedBadge")}</Badge>
          )}
          <Badge variant={isConnected ? "default" : "destructive"}>
            {t(`connection.${account.connectionState ?? "disconnected"}`)}
          </Badge>
          <Badge variant={isConfigured ? "default" : "outline"}>
            {isConfigured ? tm("reporting") : tm("notReporting")}
          </Badge>
          {isPartial && <Badge variant="destructive">{tm("partiallyConfigured")}</Badge>}
          {isTestMode && <Badge variant="destructive">{tm("testMode")}</Badge>}
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {account.deactivatedAt && (
            <span>
              {t("deactivatedOn", {
                date: new Date(account.deactivatedAt).toLocaleString(),
              })}
            </span>
          )}
          {isConnected && account.pairedPhone && (
            <span>
              {t("pairedAs", { phone: account.pairedPhone })}
              {account.pairedAt
                ? ` · ${new Date(account.pairedAt).toLocaleString()}`
                : ""}
            </span>
          )}
          {hasNoConversions ? (
            <span>{tm("noConversionsYet")}</span>
          ) : null}
          {visibleConversionCounts(account.counts).map(({ status, count }) => (
            <span key={status}>{t(`count.${status}`, { count })}</span>
          ))}
        </div>
      </div>
      <ChevronRight className="text-muted-foreground size-4 shrink-0" />
    </Link>
  );
}
