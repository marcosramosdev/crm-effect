"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Contact } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ArrowRight, Eye, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  extractVariableNames,
  resolveVariableValues,
  substituteVariables,
} from "@/lib/whatsapp/broadcast-variables";

const SAMPLE_CONTACT: Contact = {
  id: "sample",
  user_id: "",
  account_id: "",
  name: "John Doe",
  phone: "+1234567890",
  email: "john@example.com",
  company: "Acme Corp",
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

interface Step3Props {
  /** The composed body from Step 1 — read-only here, just parsed for placeholders. */
  messageBody: string;
  /** Per-variable fallback, keyed by the placeholder name exactly as written. */
  variableDefaults: Record<string, string>;
  onUpdate: (defaults: Record<string, string>) => void;
  onNext: () => void;
  onBack: () => void;
}

/**
 * Step 3 of the broadcast wizard: set a fallback for each `{{field}}`
 * placeholder in the composed body, and preview the resolved message
 * against a real (or sample) recipient.
 *
 * Replaces the old positional `{{1}}`/`{{2}}` → contact-or-custom-field
 * mapping UI (design.md D5): the placeholder's own name now says which
 * field it reads from, so there's nothing left to "map" — only an
 * optional fallback for when a recipient has no value for it.
 */
export function Step3Personalize({
  messageBody,
  variableDefaults,
  onUpdate,
  onNext,
  onBack,
}: Step3Props) {
  const t = useTranslations("Broadcasts.wizard");
  const [sampleContact, setSampleContact] = useState<Contact | null>(null);
  const [sampleCustomValues, setSampleCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  const variableNames = useMemo(
    () => extractVariableNames(messageBody),
    [messageBody],
  );

  // Load a representative contact + its custom-field values (by name, so
  // the preview can resolve a non-built-in placeholder) for the live
  // preview below. Falls back to synthetic sample data when the account
  // has no contacts yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingPreview(true);
      const supabase = createClient();
      const { data: contact } = await supabase
        .from("contacts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setSampleContact(contact ?? null);

      if (contact) {
        const { data: values } = await supabase
          .from("contact_custom_values")
          .select("value, custom_fields(field_name)")
          .eq("contact_id", contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of (values ?? []) as {
            value: string | null;
            custom_fields:
              { field_name: string } | { field_name: string }[] | null;
          }[]) {
            const field = Array.isArray(row.custom_fields)
              ? row.custom_fields[0]
              : row.custom_fields;
            if (field?.field_name) {
              map.set(field.field_name.toLowerCase(), row.value ?? "");
            }
          }
          setSampleCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const previewContact = sampleContact ?? SAMPLE_CONTACT;

  const { values: previewValues, unresolvedVariable } = useMemo(
    () =>
      resolveVariableValues(
        variableNames,
        {
          name: previewContact.name,
          phone: previewContact.phone,
          email: previewContact.email,
          company: previewContact.company,
          customValues: sampleContact
            ? sampleCustomValues
            : new Map<string, string>(),
        },
        variableDefaults,
      ),
    [
      variableNames,
      previewContact,
      sampleContact,
      sampleCustomValues,
      variableDefaults,
    ],
  );

  const previewText = useMemo(
    () => substituteVariables(messageBody, previewValues),
    [messageBody, previewValues],
  );

  const previewLabel = sampleContact
    ? sampleContact.name || sampleContact.phone
    : t("personalize.previewSample");

  function updateDefault(name: string, value: string) {
    onUpdate({ ...variableDefaults, [name]: value });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t("personalize.title")}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t("personalize.subtitle")}
        </p>
      </div>

      {variableNames.length === 0 ? (
        <div className="border-border bg-card/50 rounded-xl border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            {t("personalize.noPreview")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {variableNames.map((name) => (
            <div
              key={name}
              className="border-border bg-card/50 rounded-xl border p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-medium">
                  {`{{${name}}}`}
                </span>
              </div>
              <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                {t("personalize.fallbackLabel")}
              </label>
              <Input
                value={variableDefaults[name] ?? ""}
                onChange={(e) => updateDefault(name, e.target.value)}
                placeholder={t("personalize.fallbackPlaceholder")}
                className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
              />
            </div>
          ))}
        </div>
      )}

      {/* Live Preview — rendered as a WhatsApp-style bubble. */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="text-primary h-4 w-4" />
          <p className="text-foreground text-sm font-medium">
            {t("personalize.preview")}
          </p>
          <span className="text-muted-foreground text-xs">
            ({previewLabel})
          </span>
          {loadingPreview && (
            <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
          )}
        </div>
        <div className="rounded-lg bg-[#0e1a12] p-3">
          <div className="bg-primary/30 ml-auto max-w-[85%] rounded-lg px-3 py-2 shadow-sm">
            <p className="text-primary text-sm whitespace-pre-wrap">
              {previewText}
            </p>
          </div>
        </div>
      </div>

      {unresolvedVariable && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {t("personalize.unresolvedWarning", { name: unresolvedVariable })}
        </div>
      )}

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("back")}
        </Button>
        <Button
          onClick={onNext}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("next")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
