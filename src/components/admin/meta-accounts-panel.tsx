"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface AccountMetaRow {
  id: string;
  name: string;
  metaDatasetId: string | null;
  hasAccessToken: boolean;
  metaPageId: string | null;
  metaEventName: string;
  metaTestEventCode: string | null;
  metaSendPh: boolean;
  pendingCount: number;
  unconfiguredCount: number;
}

// Operator counters (tasks.md 6.1-6.3) + the D8 edit form (tasks.md 5.6),
// one row per account. Never receives the access token itself — only
// `hasAccessToken` — so a client bundle inspection can't recover it
// (provisioning spec.md, "Credentials are absent from client responses").
export function MetaAccountsPanel({ accounts }: { accounts: AccountMetaRow[] }) {
  const t = useTranslations("AdminConsole.metaConfig");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">{t("sectionTitle")}</CardTitle>
        <CardDescription>{t("sectionDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            expanded={expandedId === account.id}
            onToggle={() =>
              setExpandedId((prev) => (prev === account.id ? null : account.id))
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Pure classification of one account's row state (tasks.md 6.1-6.3) —
 * split out from the rendered row so it has a runnable check without
 * standing up a component-rendering test harness this repo doesn't
 * otherwise use.
 */
export function classifyAccountMetaStatus(account: AccountMetaRow) {
  const isConfigured = Boolean(account.metaDatasetId) && account.hasAccessToken;
  const isPartial = Boolean(account.metaDatasetId) !== account.hasAccessToken;
  const isTestMode = Boolean(account.metaTestEventCode);
  const hasNoConversions = account.pendingCount === 0 && account.unconfiguredCount === 0;
  return { isConfigured, isPartial, isTestMode, hasNoConversions };
}

function AccountRow({
  account,
  expanded,
  onToggle,
}: {
  account: AccountMetaRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("AdminConsole.metaConfig");

  const { isConfigured, isPartial, isTestMode, hasNoConversions } =
    classifyAccountMetaStatus(account);

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="text-foreground truncate font-medium">{account.name}</span>
          <Badge variant={isConfigured ? "default" : "outline"}>
            {isConfigured ? t("reporting") : t("notReporting")}
          </Badge>
          {isPartial && <Badge variant="destructive">{t("partiallyConfigured")}</Badge>}
          {isTestMode && <Badge variant="destructive">{t("testMode")}</Badge>}
          {hasNoConversions ? (
            <span className="text-muted-foreground text-xs">{t("noConversionsYet")}</span>
          ) : (
            <span className="text-muted-foreground text-xs">
              {t("pendingCount", { count: account.pendingCount })} ·{" "}
              {t("unconfiguredCount", { count: account.unconfiguredCount })}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="text-muted-foreground size-4 shrink-0" />
        ) : (
          <ChevronDown className="text-muted-foreground size-4 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="border-border border-t px-4 py-4">
          <AccountMetaForm account={account} />
        </div>
      )}
    </div>
  );
}

interface FormState {
  metaDatasetId: string;
  metaAccessToken: string;
  metaPageId: string;
  metaEventName: string;
  metaTestEventCode: string;
  metaSendPh: boolean;
}

function AccountMetaForm({ account }: { account: AccountMetaRow }) {
  const t = useTranslations("AdminConsole.metaConfig");
  const checklist = t.raw("setupChecklist") as string[];

  const [form, setForm] = useState<FormState>({
    metaDatasetId: account.metaDatasetId ?? "",
    metaAccessToken: "",
    metaPageId: account.metaPageId ?? "",
    metaEventName: account.metaEventName,
    metaTestEventCode: account.metaTestEventCode ?? "",
    metaSendPh: account.metaSendPh,
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
    </form>
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
