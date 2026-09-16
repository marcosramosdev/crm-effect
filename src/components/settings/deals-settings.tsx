"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Coins, Loader2, Plus, X } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import {
  DEFAULT_FOLLOWUP_OFFSETS,
  DEFAULT_FOLLOWUP_TEMPLATE,
  DEFAULT_STALE_LEAD_DAYS,
  MAX_FOLLOWUP_OFFSETS,
  readFollowupSettings,
  validateFollowupSettings,
  type FollowupSettings,
} from "@/lib/followups/settings";
import { FOLLOWUP_PLACEHOLDERS } from "@/lib/followups/template";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useTranslations } from "next-intl";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Deals settings — account-wide default currency, plus the follow-up
 * configuration (design.md D4: reminder offsets, reminder template,
 * stale-lead threshold). Both write straight to `accounts`; the
 * `accounts_update` RLS policy (admin+) is the backstop, this panel
 * just disables the controls for anyone below that so the UI doesn't
 * bother submitting a write RLS would reject anyway.
 */
export function DealsSettings() {
  const t = useTranslations("Settings.deals");
  return (
    <section className="animate-in fade-in-50 max-w-2xl space-y-6 duration-200">
      <SettingsPanelHead title={t("title")} description={t("description")} />
      <CurrencyCard />
      <FollowupSettingsCard />
    </section>
  );
}

function CurrencyCard() {
  const supabase = createClient();
  const {
    accountId,
    defaultCurrency,
    canEditSettings,
    profileLoading,
    refreshProfile,
  } = useAuth();

  const [selected, setSelected] = useState(defaultCurrency);
  const [saving, setSaving] = useState(false);
  const t = useTranslations("Settings.deals");

  // Keep the select in sync once the profile (and its account default)
  // resolves, and after a save round-trips through refreshProfile.
  useEffect(() => {
    setSelected(defaultCurrency);
  }, [defaultCurrency]);

  const dirty = selected !== defaultCurrency;

  async function handleSave() {
    if (!accountId || !dirty) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({ default_currency: selected })
      .eq("id", accountId);
    if (error) {
      toast.error(t("saveFailed"));
      setSaving(false);
      return;
    }
    // Pull the new value back into the auth context so the deal form
    // and every total pick it up without a full reload.
    await refreshProfile();
    setSaving(false);
    toast.success(t("saveSuccess"));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Coins className="text-primary size-4" />
          {t("defaultCurrency")}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("defaultCurrencyDesc")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 sm:max-w-xs">
          <Label className="text-muted-foreground">
            {t("currencyLabel")}
          </Label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={!canEditSettings || profileLoading}
            className="border-border bg-muted text-foreground focus:border-primary focus:ring-primary h-9 w-full rounded-lg border px-2.5 text-sm outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.label}
              </option>
            ))}
          </select>
          {!canEditSettings && (
            <p className="text-muted-foreground text-xs">
              {t("adminOnlyHint")}
            </p>
          )}
        </div>

        {canEditSettings && (
          <Button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/** `minutes` -> the largest whole unit that divides it evenly, for the "= X" hint next to each offset input. */
function describeMinutes(
  minutes: number,
  t: ReturnType<typeof useTranslations>,
): string {
  if (minutes > 0 && minutes % 1440 === 0) {
    return t("followupOffsetDays", { count: minutes / 1440 });
  }
  if (minutes > 0 && minutes % 60 === 0) {
    return t("followupOffsetHours", { count: minutes / 60 });
  }
  return t("followupOffsetRawMinutes", { count: minutes });
}

function settingsEqual(a: FollowupSettings, b: FollowupSettings): boolean {
  return (
    a.template === b.template &&
    a.staleLeadDays === b.staleLeadDays &&
    a.offsets.length === b.offsets.length &&
    a.offsets.every((o, i) => o === b.offsets[i])
  );
}

function FollowupSettingsCard() {
  const supabase = createClient();
  const { accountId, canEditSettings, profileLoading } = useAuth();
  const t = useTranslations("Settings.deals");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offsets, setOffsets] = useState<number[]>([...DEFAULT_FOLLOWUP_OFFSETS]);
  const [template, setTemplate] = useState(DEFAULT_FOLLOWUP_TEMPLATE);
  const [staleLeadDays, setStaleLeadDays] = useState(DEFAULT_STALE_LEAD_DAYS);
  const [loaded, setLoaded] = useState<FollowupSettings | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("accounts")
        .select("followup_offsets, followup_reminder_template, stale_lead_days")
        .eq("id", accountId)
        .maybeSingle();
      if (cancelled) return;
      const settings = readFollowupSettings(data);
      setOffsets(settings.offsets);
      setTemplate(settings.template);
      setStaleLeadDays(settings.staleLeadDays);
      setLoaded(settings);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const current: FollowupSettings = { offsets, template, staleLeadDays };
  const validation = validateFollowupSettings(current);
  const dirty = !loaded || !settingsEqual(current, loaded);

  async function handleSave() {
    if (!accountId || !validation.ok) return;
    setSaving(true);
    const { error } = await supabase
      .from("accounts")
      .update({
        followup_offsets: offsets,
        followup_reminder_template: template,
        stale_lead_days: staleLeadDays,
      })
      .eq("id", accountId);
    setSaving(false);
    if (error) {
      toast.error(t("followupSaveFailed"));
      return;
    }
    setLoaded(current);
    toast.success(t("followupSaveSuccess"));
  }

  function updateOffset(index: number, minutes: number) {
    setOffsets((prev) => prev.map((o, i) => (i === index ? minutes : o)));
  }
  function addOffset() {
    setOffsets((prev) =>
      prev.length >= MAX_FOLLOWUP_OFFSETS ? prev : [...prev, 60],
    );
  }
  function removeOffset(index: number) {
    setOffsets((prev) => prev.filter((_, i) => i !== index));
  }

  const errorMessage = !validation.ok
    ? {
        too_many_offsets: t("followupErrorTooManyOffsets"),
        non_positive_offset: t("followupErrorNonPositiveOffset"),
        duplicate_offset: t("followupErrorDuplicateOffset"),
        non_positive_threshold: t("followupErrorNonPositiveThreshold"),
        unknown_placeholder: t("followupErrorUnknownPlaceholder", {
          token: validation.unknownPlaceholders?.[0] ?? "",
        }),
      }[validation.reason]
    : null;

  if (loading || profileLoading) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center">
          <Loader2 className="text-primary size-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-foreground flex items-center gap-2">
          <Bell className="text-primary size-4" />
          {t("followupTitle")}
        </CardTitle>
        <CardDescription className="text-muted-foreground">
          {t("followupDescription")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label className="text-muted-foreground">
            {t("followupOffsetsLabel")}
          </Label>
          <p className="text-muted-foreground text-xs">
            {t("followupOffsetsHint")}
          </p>
          {offsets.length === 0 && (
            <p className="text-muted-foreground text-xs italic">
              {t("followupOffsetsEmpty")}
            </p>
          )}
          <div className="space-y-2">
            {offsets.map((minutes, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={minutes}
                  disabled={!canEditSettings}
                  onChange={(e) => updateOffset(i, Number(e.target.value))}
                  className="bg-muted border-border text-foreground w-28"
                />
                <span className="text-muted-foreground w-32 text-xs">
                  {t("followupOffsetsUnit")}
                </span>
                <span className="text-muted-foreground/70 text-xs">
                  {describeMinutes(minutes, t)}
                </span>
                {canEditSettings && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeOffset(i)}
                    aria-label={t("followupRemoveOffset")}
                  >
                    <X className="size-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {canEditSettings && offsets.length < MAX_FOLLOWUP_OFFSETS && (
            <Button type="button" variant="outline" size="sm" onClick={addOffset}>
              <Plus className="mr-1 size-4" />
              {t("followupAddOffset")}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground">
            {t("followupTemplateLabel")}
          </Label>
          <Textarea
            value={template}
            disabled={!canEditSettings}
            onChange={(e) => setTemplate(e.target.value)}
            rows={3}
            className="bg-muted border-border text-foreground"
          />
          <p className="text-muted-foreground text-xs">
            {t("followupTemplateHint", {
              placeholders: FOLLOWUP_PLACEHOLDERS.map((p) => `{${p}}`).join(", "),
            })}
          </p>
          <p className="text-muted-foreground/70 text-xs">
            {t("followupMedicoHint")}
          </p>
        </div>

        <div className="grid gap-2 sm:max-w-xs">
          <Label className="text-muted-foreground">
            {t("followupStaleDaysLabel")}
          </Label>
          <Input
            type="number"
            min={1}
            value={staleLeadDays}
            disabled={!canEditSettings}
            onChange={(e) => setStaleLeadDays(Number(e.target.value))}
            className="bg-muted border-border text-foreground"
          />
        </div>

        {!canEditSettings && (
          <p className="text-muted-foreground text-xs">{t("adminOnlyHint")}</p>
        )}
        {errorMessage && (
          <p className="text-destructive text-xs">{errorMessage}</p>
        )}

        {canEditSettings && (
          <Button
            onClick={handleSave}
            disabled={saving || !dirty || !validation.ok}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("saving")}
              </>
            ) : (
              t("save")
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
