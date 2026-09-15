"use client";

import type { DealCustomField } from "@/types";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";

export type BoardFilterMode = "any" | "none" | "value";

export interface BoardFilter {
  fieldId: string;
  mode: BoardFilterMode;
  /** Canonical stored form; only meaningful when `mode === 'value'`. */
  value: string;
}

const SELECT_CLASS =
  "h-8 rounded-lg border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-primary";

/**
 * Filter the pipeline board by a deal custom field value. Emits a
 * {@link BoardFilter} (or null to clear). The actual filtering — an
 * extra `deal_custom_values` query plus an in-memory pass — lives in
 * the pipelines page (design.md D3).
 */
export function DealBoardFilter({
  fields,
  value,
  onChange,
  hiddenCount,
}: {
  fields: DealCustomField[];
  value: BoardFilter | null;
  onChange: (next: BoardFilter | null) => void;
  /** How many deals the active filter is hiding, for the banner. */
  hiddenCount: number;
}) {
  const t = useTranslations("Pipelines.filter");
  if (fields.length === 0) return null;

  const active = value;
  const field = active
    ? (fields.find((f) => f.id === active.fieldId) ?? null)
    : null;

  function setField(fieldId: string) {
    if (!fieldId) {
      onChange(null);
      return;
    }
    onChange({ fieldId, mode: "any", value: "" });
  }

  function setMode(mode: BoardFilterMode) {
    if (!active) return;
    onChange({ ...active, mode, value: mode === "value" ? active.value : "" });
  }

  function setValue(v: string) {
    if (!active) return;
    onChange({ ...active, value: v });
  }

  return (
    <div className="border-border bg-card/60 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
      <span className="text-muted-foreground text-xs font-medium">
        {t("label")}
      </span>

      <select
        value={active?.fieldId ?? ""}
        onChange={(e) => setField(e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="">{t("noField")}</option>
        {fields.map((f) => (
          <option key={f.id} value={f.id}>
            {f.field_name}
          </option>
        ))}
      </select>

      {active && field && (
        <>
          <select
            value={active.mode}
            onChange={(e) => setMode(e.target.value as BoardFilterMode)}
            className={SELECT_CLASS}
          >
            <option value="any">{t("hasAny")}</option>
            <option value="none">{t("hasNone")}</option>
            <option value="value">{t("equals")}</option>
          </select>

          {active.mode === "value" &&
            (field.field_type === "select" ? (
              <select
                value={active.value}
                onChange={(e) => setValue(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t("pickValue")}</option>
                {(field.field_options?.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : field.field_type === "checkbox" ? (
              <select
                value={active.value}
                onChange={(e) => setValue(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t("pickValue")}</option>
                <option value="true">{t("yes")}</option>
                <option value="false">{t("no")}</option>
              </select>
            ) : (
              <input
                type={
                  field.field_type === "number"
                    ? "number"
                    : field.field_type === "date"
                      ? "date"
                      : "text"
                }
                value={active.value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={t("pickValue")}
                className={SELECT_CLASS}
              />
            ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(null)}
            className="text-muted-foreground"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            {t("clear")}
          </Button>

          <span className="text-muted-foreground text-xs">
            {t("hiddenCount", { count: hiddenCount })}
          </span>
        </>
      )}
    </div>
  );
}
