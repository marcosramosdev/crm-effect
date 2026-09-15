"use client";

import { Shield, Tag as TagIcon } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { useCan } from "@/hooks/use-can";
import { DealFieldsPanel } from "./deal-fields-panel";
import { SettingsChip } from "./settings-chip";

/**
 * Settings → "Fields & tags" → Deal fields card. Manages the
 * account-wide typed deal custom field catalogue (migration 042),
 * distinct from the contact custom field catalogue above it.
 *
 * Unlike the contact card, this one is shown to non-admins too — the
 * spec requires the catalogue be readable by any member — but every
 * edit affordance is removed via `readOnly`. `deal_custom_fields` RLS
 * rejects non-admin writes regardless.
 */
export function DealFieldsSettings() {
  const t = useTranslations("Settings.dealFields");
  const canEditSettings = useCan("edit-settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <TagIcon className="text-primary size-4" />
          {t("cardTitle")}
          <SettingsChip variant="admin" className="font-medium">
            <Shield />
            {t("adminRole")}
          </SettingsChip>
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("cardDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DealFieldsPanel readOnly={!canEditSettings} />
      </CardContent>
    </Card>
  );
}
