"use client";

import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";

import { deriveAccountSetup, type AccountMetaRow } from "@/lib/admin/account-status";

/**
 * The setup conditions the system determines for itself, shown as
 * state. The ones it cannot determine live in the form's reminder block
 * instead — stated, never claimed as known (design.md D11).
 */
export function AccountSetupState({
  account,
  hasAdOriginatedContact,
}: {
  account: AccountMetaRow;
  hasAdOriginatedContact: boolean;
}) {
  const t = useTranslations("AdminConsole.setup");
  const setup = deriveAccountSetup({ account, hasAdOriginatedContact });

  const items = [
    ["whatsappConnected", setup.whatsappConnected],
    ["credentialsPresent", setup.credentialsPresent],
    ["testModeCleared", setup.testModeCleared],
    ["adContactArrived", setup.adContactArrived],
    ["conversionRecorded", setup.conversionRecorded],
  ] as const;

  return (
    <ul className="space-y-2 text-sm">
      {items.map(([key, done]) => (
        <li key={key} className="flex items-start gap-2">
          {done ? (
            <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <X className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          )}
          <span className={done ? "text-foreground" : "text-muted-foreground"}>
            {t(key)}
          </span>
        </li>
      ))}
    </ul>
  );
}
