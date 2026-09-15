"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import type { DealCustomField, DealFieldType } from "@/types";
import {
  validateDealFieldName,
  validateSelectOptions,
  fieldTypeNeedsOptions,
} from "@/lib/deals/custom-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

const FIELD_TYPES: DealFieldType[] = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
];

const SELECT_CLASS =
  "h-9 rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50";

interface DealFieldsPanelProps {
  /** When true, the catalogue is shown but not editable (non-admin). */
  readOnly?: boolean;
}

/**
 * Create / rename / retype / reorder / delete the account-wide deal
 * custom field catalogue (migration 042). This is a separate catalogue
 * from contact custom fields — a definition here never appears on a
 * contact. Per-deal values are edited in the deal detail view.
 *
 * Admin+ gated by the caller and by `deal_custom_fields` RLS; `readOnly`
 * renders the same list with every edit affordance removed.
 */
export function DealFieldsPanel({ readOnly = false }: DealFieldsPanelProps) {
  const t = useTranslations("Settings.dealFields");
  const supabase = createClient();
  const { user, accountId } = useAuth();

  const [fields, setFields] = useState<DealCustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<DealFieldType>("text");
  const [newOptions, setNewOptions] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchFields = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const { data } = await supabase
      .from("deal_custom_fields")
      .select("*")
      .order("position")
      .order("field_name");
    setFields((data as DealCustomField[] | null) ?? []);
    setLoading(false);
  }, [supabase, accountId]);

  useEffect(() => {
    if (accountId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchFields();
    }
  }, [accountId, fetchFields]);

  async function handleCreate() {
    if (readOnly) return;
    const nameCheck = validateDealFieldName(
      newName,
      fields.map((f) => f.field_name),
    );
    if (!nameCheck.ok) {
      toast.error(
        nameCheck.reason === "blank"
          ? t("errNameBlank")
          : t("errNameDuplicate", { name: newName.trim() }),
      );
      return;
    }
    if (!accountId || !user) {
      toast.error(t("errNoAccount"));
      return;
    }

    let field_options: { options: string[] } | null = null;
    if (fieldTypeNeedsOptions(newType)) {
      const optCheck = validateSelectOptions(newOptions.split("\n"));
      if (!optCheck.ok) {
        toast.error(t("errOptionsEmpty"));
        return;
      }
      field_options = { options: optCheck.options };
    }

    setCreating(true);
    const { error } = await supabase.from("deal_custom_fields").insert({
      field_name: nameCheck.name,
      field_type: newType,
      field_options,
      position: fields.length,
      user_id: user.id,
      account_id: accountId,
    });
    setCreating(false);

    if (error) {
      toast.error(t("errCreateFailed"));
      return;
    }
    toast.success(t("created", { name: nameCheck.name }));
    setNewName("");
    setNewType("text");
    setNewOptions("");
    await fetchFields();
  }

  async function handleRename(
    field: DealCustomField,
    nextName: string,
  ): Promise<boolean> {
    const others = fields
      .filter((f) => f.id !== field.id)
      .map((f) => f.field_name);
    const check = validateDealFieldName(nextName, others);
    if (!check.ok) {
      if (check.reason === "duplicate") {
        toast.error(t("errNameDuplicate", { name: nextName.trim() }));
        return false;
      }
      // blank -> silently revert
      return false;
    }
    if (check.name === field.field_name) return true;

    setBusyId(field.id);
    const { error } = await supabase
      .from("deal_custom_fields")
      .update({ field_name: check.name })
      .eq("id", field.id);
    setBusyId(null);
    if (error) {
      toast.error(t("errRenameFailed"));
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleRetype(field: DealCustomField, nextType: DealFieldType) {
    if (nextType === field.field_type) return;

    let field_options: { options: string[] } | null = null;
    if (fieldTypeNeedsOptions(nextType)) {
      // Switching to select needs at least one option. Seed from any
      // existing options, else ask the user to add them via the row's
      // options editor after the retype — but the DB CHECK rejects an
      // optionless select, so require them now.
      const existing = field.field_options?.options ?? [];
      const optCheck = validateSelectOptions(existing);
      if (!optCheck.ok) {
        toast.error(t("errRetypeToSelectNeedsOptions"));
        return;
      }
      field_options = { options: optCheck.options };
    }

    if (
      !window.confirm(
        t("retypeConfirm", {
          name: field.field_name,
          from: t(`types.${field.field_type}`),
          to: t(`types.${nextType}`),
        }),
      )
    ) {
      return;
    }

    setBusyId(field.id);
    const { error } = await supabase
      .from("deal_custom_fields")
      .update({ field_type: nextType, field_options })
      .eq("id", field.id);
    setBusyId(null);
    if (error) {
      toast.error(t("errRetypeFailed"));
      return;
    }
    await fetchFields();
  }

  async function handleSaveOptions(field: DealCustomField, raw: string) {
    const check = validateSelectOptions(raw.split("\n"));
    if (!check.ok) {
      toast.error(t("errOptionsEmpty"));
      return false;
    }
    setBusyId(field.id);
    const { error } = await supabase
      .from("deal_custom_fields")
      .update({ field_options: { options: check.options } })
      .eq("id", field.id);
    setBusyId(null);
    if (error) {
      toast.error(t("errOptionsFailed"));
      return false;
    }
    await fetchFields();
    return true;
  }

  async function handleMove(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= fields.length) return;
    const a = fields[index];
    const b = fields[target];
    setBusyId(a.id);
    // Two updates rather than an upsert: upsert would need every NOT NULL
    // column for its INSERT arm even though only the UPDATE arm runs.
    const [r1, r2] = await Promise.all([
      supabase
        .from("deal_custom_fields")
        .update({ position: b.position })
        .eq("id", a.id),
      supabase
        .from("deal_custom_fields")
        .update({ position: a.position })
        .eq("id", b.id),
    ]);
    setBusyId(null);
    if (r1.error || r2.error) {
      toast.error(t("errReorderFailed"));
    }
    await fetchFields();
  }

  async function handleDelete(field: DealCustomField) {
    if (!window.confirm(t("deleteConfirm", { name: field.field_name }))) return;
    setBusyId(field.id);
    const { error } = await supabase
      .from("deal_custom_fields")
      .delete()
      .eq("id", field.id);
    setBusyId(null);
    if (error) {
      toast.error(t("errDeleteFailed"));
      return;
    }
    toast.success(t("deleted", { name: field.field_name }));
    await fetchFields();
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="border-border space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newType !== "select") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              placeholder={t("namePlaceholder")}
              className="bg-muted text-foreground min-w-40 flex-1"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as DealFieldType)}
              className={SELECT_CLASS}
              aria-label={t("typeLabel")}
            >
              {FIELD_TYPES.map((ft) => (
                <option key={ft} value={ft}>
                  {t(`types.${ft}`)}
                </option>
              ))}
            </select>
            <Button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
            >
              {creating ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {t("addField")}
            </Button>
          </div>
          {newType === "select" && (
            <Textarea
              value={newOptions}
              onChange={(e) => setNewOptions(e.target.value)}
              placeholder={t("optionsPlaceholder")}
              className="bg-muted text-foreground min-h-[72px]"
            />
          )}
        </div>
      )}

      <div className="border-border rounded-md border">
        {loading ? (
          <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
            <Loader2 className="size-4 animate-spin" />
            {t("loading")}
          </div>
        ) : fields.length === 0 ? (
          <p className="text-muted-foreground py-8 text-center text-sm">
            {t("empty")}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {fields.map((field, i) => (
              <DealFieldRow
                key={field.id}
                field={field}
                index={i}
                count={fields.length}
                busy={busyId === field.id}
                readOnly={readOnly}
                otherTypeLabel={(ft) => t(`types.${ft}`)}
                onRename={handleRename}
                onRetype={handleRetype}
                onSaveOptions={handleSaveOptions}
                onMove={handleMove}
                onDelete={handleDelete}
                labels={{
                  moveUp: t("moveUp"),
                  moveDown: t("moveDown"),
                  editOptions: t("editOptions"),
                  optionsPlaceholder: t("optionsPlaceholder"),
                  save: t("save"),
                  cancel: t("cancel"),
                  deleteTitle: t("deleteTitle"),
                  renameAria: (n: string) => t("renameAria", { name: n }),
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface RowLabels {
  moveUp: string;
  moveDown: string;
  editOptions: string;
  optionsPlaceholder: string;
  save: string;
  cancel: string;
  deleteTitle: string;
  renameAria: (name: string) => string;
}

function DealFieldRow({
  field,
  index,
  count,
  busy,
  readOnly,
  otherTypeLabel,
  onRename,
  onRetype,
  onSaveOptions,
  onMove,
  onDelete,
  labels,
}: {
  field: DealCustomField;
  index: number;
  count: number;
  busy: boolean;
  readOnly: boolean;
  otherTypeLabel: (ft: DealFieldType) => string;
  onRename: (field: DealCustomField, name: string) => Promise<boolean>;
  onRetype: (field: DealCustomField, type: DealFieldType) => void;
  onSaveOptions: (field: DealCustomField, raw: string) => Promise<boolean>;
  onMove: (index: number, dir: -1 | 1) => void;
  onDelete: (field: DealCustomField) => void;
  labels: RowLabels;
}) {
  const [name, setName] = useState(field.field_name);
  const [editingOptions, setEditingOptions] = useState(false);
  const [optionsDraft, setOptionsDraft] = useState(
    (field.field_options?.options ?? []).join("\n"),
  );

  // Keep the local name in sync if the list refetches with a new value.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName(field.field_name);
  }, [field.field_name]);

  async function commitName() {
    if (name.trim() === field.field_name) {
      setName(field.field_name);
      return;
    }
    const ok = await onRename(field, name);
    if (!ok) setName(field.field_name);
  }

  if (readOnly) {
    return (
      <li className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="text-foreground">{field.field_name}</span>
        <span className="text-muted-foreground text-xs">
          {otherTypeLabel(field.field_type)}
          {field.field_type === "select" && field.field_options?.options
            ? ` · ${field.field_options.options.join(", ")}`
            : ""}
        </span>
      </li>
    );
  }

  return (
    <li className="space-y-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button
            type="button"
            aria-label={labels.moveUp}
            disabled={busy || index === 0}
            onClick={() => onMove(index, -1)}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            aria-label={labels.moveDown}
            disabled={busy || index === count - 1}
            onClick={() => onMove(index, 1)}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>

        <Input
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          aria-label={labels.renameAria(field.field_name)}
          className="text-foreground hover:border-border focus:border-primary h-8 flex-1 border-transparent bg-transparent"
        />

        <select
          value={field.field_type}
          disabled={busy}
          onChange={(e) => onRetype(field, e.target.value as DealFieldType)}
          className={SELECT_CLASS}
        >
          {FIELD_TYPES.map((ft) => (
            <option key={ft} value={ft}>
              {otherTypeLabel(ft)}
            </option>
          ))}
        </select>

        {field.field_type === "select" && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => {
              setOptionsDraft((field.field_options?.options ?? []).join("\n"));
              setEditingOptions((v) => !v);
            }}
            className="text-muted-foreground shrink-0"
          >
            {labels.editOptions}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          onClick={() => onDelete(field)}
          title={labels.deleteTitle}
          className="text-muted-foreground shrink-0 hover:text-red-400"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
        </Button>
      </div>

      {editingOptions && field.field_type === "select" && (
        <div className="space-y-2 pl-8">
          <Textarea
            value={optionsDraft}
            onChange={(e) => setOptionsDraft(e.target.value)}
            placeholder={labels.optionsPlaceholder}
            className="bg-muted text-foreground min-h-[72px]"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                const ok = await onSaveOptions(field, optionsDraft);
                if (ok) setEditingOptions(false);
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {labels.save}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingOptions(false)}
              className="text-muted-foreground"
            >
              {labels.cancel}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
