"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CONVERSION_STATUSES, type ConversionStatus } from "@/lib/admin/account-status";

export interface ConversionRow {
  id: string;
  /** `null` for a contact with no name — never replaced by the phone number. */
  contactName: string | null;
  status: ConversionStatus;
  eventTime: string;
  attempts: number;
  lastError: string | null;
}

/**
 * The account's most recent conversions.
 *
 * Carries neither the contact's phone number nor the ad click id: the
 * server never fetches them (design.md D8). The filter runs over the
 * rows already loaded, so narrowing cannot quietly re-window the list
 * onto a different fifty (design.md D7).
 */
export function AccountConversions({ rows }: { rows: ConversionRow[] }) {
  const t = useTranslations("AdminConsole.conversions");
  const [status, setStatus] = useState<ConversionStatus | "all">("all");

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("none")}</p>;
  }

  const present = CONVERSION_STATUSES.filter((s) => rows.some((r) => r.status === s));
  const shown = status === "all" ? rows : rows.filter((r) => r.status === status);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={status === "all" ? "default" : "outline"}
          onClick={() => setStatus("all")}
        >
          {t("filterAll", { count: rows.length })}
        </Button>
        {present.map((s) => (
          <Button
            key={s}
            type="button"
            size="sm"
            variant={status === s ? "default" : "outline"}
            onClick={() => setStatus(s)}
          >
            {t(`status.${s}`)}
          </Button>
        ))}
      </div>

      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">{t("contact")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("state")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("eventTime")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("attempts")}</th>
              <th className="px-3 py-2 text-left font-medium">{t("lastError")}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} className="border-border border-t">
                <td className="text-foreground px-3 py-2">
                  {row.contactName ?? (
                    <span className="text-muted-foreground italic">{t("unnamed")}</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{t(`status.${row.status}`)}</Badge>
                </td>
                <td className="text-muted-foreground px-3 py-2">
                  {new Date(row.eventTime).toLocaleString()}
                </td>
                <td className="text-muted-foreground px-3 py-2">{row.attempts}</td>
                <td
                  className="text-muted-foreground px-3 py-2"
                  title={row.lastError ?? undefined}
                >
                  {row.lastError ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
