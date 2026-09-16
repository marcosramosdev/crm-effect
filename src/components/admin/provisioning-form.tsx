"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Loader2, ShieldCheck, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SPECIALTY_KEYS, type SpecialtyKey } from "@/lib/provisioning/templates";

interface FormState {
  clinicName: string;
  clientFullName: string;
  clientEmail: string;
  clientPassword: string;
  specialty: SpecialtyKey;
  persona: string;
  metaDatasetId: string;
  metaAccessToken: string;
}

const EMPTY_FORM: FormState = {
  clinicName: "",
  clientFullName: "",
  clientEmail: "",
  clientPassword: "",
  specialty: "dentist",
  persona: "",
  metaDatasetId: "",
  metaAccessToken: "",
};

interface FailureResult {
  error: string;
  step?: string;
  survivors?: { authUserId?: string; accountId?: string } | null;
}

// The delivered password only ever lives in this component's own
// state — the server never echoes it back (client-provisioning spec,
// "No e-mail is sent" / "operator sees the client's password ...
// never stored or logged").
export function ProvisioningForm() {
  const t = useTranslations("AdminConsole");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ email: string; password: string } | null>(
    null,
  );
  const [failure, setFailure] = useState<FailureResult | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t("copied"));
    } catch {
      toast.error(t("clipboardBlocked"));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFailure(null);

    try {
      const res = await fetch("/api/admin/provision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = await res.json();

      if (!res.ok) {
        setFailure(json as FailureResult);
        return;
      }

      setSuccess({ email: json.email as string, password: form.clientPassword });
      setForm(EMPTY_FORM);
    } catch {
      setFailure({ error: t("networkError") });
    } finally {
      setSubmitting(false);
    }
  }

  if (success) {
    return (
      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-foreground flex items-center gap-2">
            <ShieldCheck className="text-primary size-5" />
            {t("successTitle")}
          </CardTitle>
          <CardDescription>{t("successDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <CredentialRow
            label={t("clientEmail")}
            value={success.email}
            onCopy={() => copy(success.email)}
            copyLabel={t("copy")}
          />
          <CredentialRow
            label={t("clientPassword")}
            value={success.password}
            onCopy={() => copy(success.password)}
            copyLabel={t("copy")}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => setSuccess(null)}
            className="w-full"
          >
            {t("provisionAnother")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">{t("title")}</CardTitle>
        <CardDescription>{t("desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          {failure && (
            <div className="border-destructive/30 bg-destructive/10 text-destructive flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div>
                <p>{failure.error}</p>
                {failure.step && (
                  <p className="text-destructive/80 mt-1 text-xs">
                    {t("failedStep", { step: failure.step })}
                  </p>
                )}
                {failure.survivors &&
                  (failure.survivors.authUserId || failure.survivors.accountId) && (
                    <p className="text-destructive/80 mt-1 font-mono text-xs">
                      {t("cleanupIncomplete", {
                        authUserId: failure.survivors.authUserId ?? "—",
                        accountId: failure.survivors.accountId ?? "—",
                      })}
                    </p>
                  )}
              </div>
            </div>
          )}

          <Field label={t("clinicName")}>
            <Input
              value={form.clinicName}
              onChange={(e) => set("clinicName", e.target.value)}
              required
            />
          </Field>

          <Field label={t("clientFullName")}>
            <Input
              value={form.clientFullName}
              onChange={(e) => set("clientFullName", e.target.value)}
              required
            />
          </Field>

          <Field label={t("clientEmail")}>
            <Input
              type="email"
              value={form.clientEmail}
              onChange={(e) => set("clientEmail", e.target.value)}
              required
            />
          </Field>

          <Field label={t("clientPassword")}>
            <Input
              type="text"
              autoComplete="off"
              value={form.clientPassword}
              onChange={(e) => set("clientPassword", e.target.value)}
              required
            />
          </Field>

          <Field label={t("specialty")}>
            <Select
              value={form.specialty}
              onValueChange={(v) => set("specialty", v as SpecialtyKey)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SPECIALTY_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>
                    {t(`specialties.${key}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("persona")}>
            <Textarea
              value={form.persona}
              onChange={(e) => set("persona", e.target.value)}
              rows={4}
              required
            />
          </Field>

          <Field label={t("metaDatasetId")}>
            <Input
              value={form.metaDatasetId}
              onChange={(e) => set("metaDatasetId", e.target.value)}
              required
            />
          </Field>

          <Field label={t("metaAccessToken")}>
            <Input
              type="text"
              autoComplete="off"
              value={form.metaAccessToken}
              onChange={(e) => set("metaAccessToken", e.target.value)}
              required
            />
          </Field>

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("submitting")}
              </>
            ) : (
              t("submit")
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CredentialRow({
  label,
  value,
  onCopy,
  copyLabel,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copyLabel: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">{label}</Label>
      <div className="flex gap-2">
        <Input
          readOnly
          value={value}
          className="bg-muted border-border text-foreground font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button type="button" onClick={onCopy} className="shrink-0">
          <Copy className="size-4" />
          {copyLabel}
        </Button>
      </div>
    </div>
  );
}
