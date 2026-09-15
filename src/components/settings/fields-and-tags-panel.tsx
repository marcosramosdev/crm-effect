"use client";

import { useCan } from "@/hooks/use-can";

import { useTranslations } from "next-intl";

import { CustomFieldsSettings } from "./custom-fields-settings";
import { DealFieldsSettings } from "./deal-fields-settings";
import { SettingsPanelHead } from "./settings-panel-head";
import { TagManager } from "./tag-manager";

/**
 * "Fields & tags" section — merges the former Tags and Custom Fields
 * tabs. Tags are visible to everyone; the contact custom-fields
 * catalogue is account-wide config, so that card is admin-gated
 * (mirroring the old hidden-tab behaviour). The deal fields catalogue
 * is shown to everyone but read-only for non-admins (its spec requires
 * the catalogue be readable by any member). Both RLS-reject non-admin
 * writes regardless.
 */
export function FieldsAndTagsPanel() {
  const t = useTranslations("Settings.tagsAndFields");
  const canEditSettings = useCan("edit-settings");

  return (
    <section className="animate-in fade-in-50 max-w-3xl space-y-4 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <TagManager />
      {canEditSettings ? <CustomFieldsSettings /> : null}
      <DealFieldsSettings />
    </section>
  );
}
