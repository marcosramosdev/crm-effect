"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AccountMetaRow } from "@/lib/admin/account-status";

interface FormState {
  metaDatasetId: string;
  metaAccessToken: string;
  metaPageId: string;
  metaEventName: string;
  metaTestEventCode: string;
  metaSendPh: boolean;
}

type CheckResult =
  | { ok: true; datasetName: string | null; ownerBusinessName: string | null }
  | { ok: false; reason: string; message: string };

/**
 * The account's advertising configuration, plus the check against Meta.
 *
 * The check sends what is currently in the fields rather than what is
 * stored, so a mistyped dataset id is caught before it is saved, and it
 * saves nothing itself (design.md D4/D6).
 */
export function AccountMetaForm({ account }: { account: AccountMetaRow }) {
  const t = useTranslations("AdminConsole.metaConfig");
  const tv = useTranslations("AdminConsole.validate");
  const checklist = t.raw("setupChecklist") as string[];
  const reminders = tv.raw("reminders") as string[];

  const [form, setForm] = useState<FormState>({
    metaDatasetId: account.metaDatasetId ?? "",
    metaAccessToken: "",
    metaPageId: account.metaPageId ?? "",
    metaEventName: account.metaEventName,
    metaTestEventCode: account.metaTestEventCode ?? "",
    metaSendPh: account.metaSendPh,
  });
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    // A result describes the values that were checked; changing any of
    // them makes it stale rather than merely old.
    if (key === "metaDatasetId" || key === "metaAccessToken") setCheck(null);
  }

  async function onValidate() {
    setChecking(true);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}/meta/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metaDatasetId: form.metaDatasetId,
          metaAccessToken: form.metaAccessToken,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setCheck({
          ok: false,
          reason: "unreachable",
          message: json?.error ?? tv("didNotComplete"),
        });
        return;
      }
      setCheck(json as CheckResult);
    } catch {
      setCheck({ ok: false, reason: "unreachable", message: tv("didNotComplete") });
    } finally {
      setChecking(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/accounts/${account.id}/meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      setForm((prev) => ({ ...prev, metaAccessToken: "" }));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="bg-muted/50 rounded-md p-3 text-sm">
        <p className="text-foreground mb-2 font-medium">{t("setupChecklistTitle")}</p>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-4">
          {checklist.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      </div>

      <FormField label={t("metaDatasetId")}>
        <Input
          value={form.metaDatasetId}
          onChange={(e) => set("metaDatasetId", e.target.value)}
        />
      </FormField>

      <FormField label={t("metaAccessToken")} hint={t("metaAccessTokenHint")}>
        <Input
          type="text"
          autoComplete="off"
          value={form.metaAccessToken}
          onChange={(e) => set("metaAccessToken", e.target.value)}
          placeholder={account.hasAccessToken ? "••••••••" : ""}
        />
      </FormField>

      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          onClick={onValidate}
          disabled={checking || !form.metaDatasetId.trim()}
        >
          {checking ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              {tv("checking")}
            </>
          ) : (
            tv("action")
          )}
        </Button>
        <p className="text-muted-foreground text-xs">{tv("hint")}</p>
        {check && <CheckOutcome result={check} />}
      </div>

      <FormField label={t("metaPageId")} hint={t("metaPageIdHint")}>
        <Input
          value={form.metaPageId}
          onChange={(e) => set("metaPageId", e.target.value)}
        />
      </FormField>

      <FormField label={t("metaEventName")} hint={t("metaEventNameWarning")}>
        <Input
          value={form.metaEventName}
          onChange={(e) => set("metaEventName", e.target.value)}
          required
        />
      </FormField>

      <FormField label={t("metaTestEventCode")} hint={t("metaTestEventCodeHint")}>
        <Input
          value={form.metaTestEventCode}
          onChange={(e) => set("metaTestEventCode", e.target.value)}
        />
      </FormField>

      <div className="flex items-start justify-between gap-3">
        <div>
          <Label className="text-foreground">{t("metaSendPh")}</Label>
          <p className="text-muted-foreground mt-1 text-xs">{t("metaSendPhHint")}</p>
        </div>
        <Switch
          checked={form.metaSendPh}
          onCheckedChange={(checked) => set("metaSendPh", checked)}
          aria-label={t("metaSendPh")}
        />
      </div>

      <Button type="submit" disabled={saving}>
        {saving ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            {t("saving")}
          </>
        ) : (
          t("save")
        )}
      </Button>

      {/* The conditions the system cannot check: reminders, never state,
          and deliberately with no control that would mark them done
          (design.md D11). */}
      <div className="bg-muted/50 rounded-md p-3 text-sm">
        <p className="text-foreground mb-2 flex items-center gap-2 font-medium">
          <HelpCircle className="size-4" />
          {tv("remindersTitle")}
        </p>
        <ul className="text-muted-foreground list-disc space-y-1 pl-4">
          {reminders.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </form>
  );
}

function CheckOutcome({ result }: { result: CheckResult }) {
  const tv = useTranslations("AdminConsole.validate");

  if (result.ok) {
    return (
      <p className="flex items-start gap-2 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        <span>
          {tv("ok", { name: result.datasetName ?? tv("unnamedDataset") })}
          {result.ownerBusinessName
            ? ` · ${tv("ownerBusiness", { name: result.ownerBusinessName })}`
            : ""}
        </span>
      </p>
    );
  }

  // Only the two failures an operator actually hits are reworded. Any
  // other rejection keeps Meta's own message, because a generic phrase
  // would leave nothing to act on (spec, "Unexpected failure keeps
  // Meta's wording").
  const worded =
    result.reason === "invalid_token"
      ? tv("invalidToken")
      : result.reason === "business_mismatch"
        ? tv("businessMismatch")
        : result.reason === "unreachable"
          ? tv("didNotComplete")
          : result.message;

  return (
    <p className="text-destructive flex items-start gap-2 text-sm">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{worded}</span>
    </p>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-foreground">{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
