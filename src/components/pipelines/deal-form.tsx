"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { setDealArchived } from "@/lib/inbox/deals";
import { useAuth } from "@/hooks/use-auth";
import { fromZonedInputValue, toZonedInputValue } from "@/lib/time/account-tz";
import { formatDate } from "@/lib/format";
import { memberLabel } from "@/lib/account/members";
import { useCan } from "@/hooks/use-can";
import {
  parseDealFieldValue,
  type DealFieldDefinition,
} from "@/lib/deals/custom-fields";
import type {
  Contact,
  Conversation,
  Deal,
  DealCustomField,
  DealNote,
  DealPriority,
  DealStatus,
  Pipeline,
  PipelineStage,
  Profile,
} from "@/types";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
  Loader2,
  Plus,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50";

const PRIORITIES: DealPriority[] = ["low", "medium", "high"];

const SOURCES = ["organic", "indication", "marketing", "others"] as const;

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId: pipelineIdProp,
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const tCommon = useTranslations("Common");
  const supabase = createClient();
  const { accountId, defaultCurrency, timeZone } = useAuth();
  const canEdit = useCan("send-messages");

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  // When editing, the pipeline is selectable (move the deal to another
  // pipeline); for a new deal it stays bound to the board's pipeline.
  const [pipelineId, setPipelineId] = useState(pipelineIdProp);
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  // New built-in attributes (migration 042). All optional; "" / unset
  // must stay distinct from 0 / 'low' / ''.
  const [priority, setPriority] = useState<"" | DealPriority>("");
  const [source, setSource] = useState("");
  const [description, setDescription] = useState("");
  const [lostReason, setLostReason] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [stageOptions, setStageOptions] = useState<PipelineStage[]>(stages);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  // Custom fields (migration 042). `fieldValues` maps field id → raw
  // input string; checkboxes carry 'true' / 'false' / ''.
  const [dealFields, setDealFields] = useState<DealCustomField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  // Notes (migration 042) — appended immediately, not batched into Save.
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [newNote, setNewNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);

  const [saving, setSaving] = useState(false);
  const [statusAction, setStatusAction] = useState<DealStatus | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLost, setConfirmLost] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setConfirmLost(false);
    setNewNote("");
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      setContactId(deal.contact_id ?? "");
      setPipelineId(deal.pipeline_id);
      setStageId(deal.stage_id);
      setStageOptions(deal.pipeline_id === pipelineIdProp ? stages : []);
      setAssignedTo(deal.assigned_to ?? "");
      setScheduledAt(
        deal.scheduled_at ? toZonedInputValue(deal.scheduled_at, timeZone) : "",
      );
      setPriority(deal.priority ?? "");
      setSource(deal.source ?? "");
      setDescription(deal.description ?? "");
      setLostReason(deal.lost_reason ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
      setPipelineId(pipelineIdProp);
      setStageOptions(stages);
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setScheduledAt("");
      setPriority("");
      setSource("");
      setDescription("");
      setLostReason("");
      setFieldValues({});
      setNotes([]);
    }
  }, [
    open,
    deal,
    defaultStageId,
    stages,
    defaultCurrency,
    pipelineIdProp,
    timeZone,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p, pl, df] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
        supabase.from("pipelines").select("*").order("created_at"),
        supabase
          .from("deal_custom_fields")
          .select("*")
          .order("position")
          .order("field_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
      setPipelines((pl.data ?? []) as Pipeline[]);
      setDealFields((df.data ?? []) as DealCustomField[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Load this deal's custom field values + note history.
  useEffect(() => {
    if (!open || !deal) return;
    let cancelled = false;
    (async () => {
      const [valuesRes, notesRes] = await Promise.all([
        supabase
          .from("deal_custom_values")
          .select("field_id, value")
          .eq("deal_id", deal.id),
        supabase
          .from("deal_notes")
          .select("*")
          .eq("deal_id", deal.id)
          .order("created_at", { ascending: false }),
      ]);
      if (cancelled) return;
      const map: Record<string, string> = {};
      (valuesRes.data ?? []).forEach(
        (v: { field_id: string; value: string | null }) => {
          map[v.field_id] = v.value ?? "";
        },
      );
      setFieldValues(map);
      setNotes((notesRes.data ?? []) as DealNote[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal, supabase]);

  useEffect(() => {
    if (!open || !deal || deal.pipeline_id === pipelineIdProp) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("pipeline_stages")
        .select("*")
        .eq("pipeline_id", deal.pipeline_id)
        .order("position");
      if (cancelled) return;
      setStageOptions((data as PipelineStage[] | null) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deal, pipelineIdProp, supabase]);

  async function handlePipelineChange(nextPipelineId: string) {
    setPipelineId(nextPipelineId);
    const { data } = await supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", nextPipelineId)
      .order("position");
    const rows = (data as PipelineStage[] | null) ?? [];
    setStageOptions(rows);
    setStageId(rows[0]?.id ?? "");
  }

  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  function authorName(userId: string | null): string {
    if (!userId) return t("noteAuthorUnknown");
    const p = profiles.find((pr) => pr.user_id === userId);
    return p?.full_name || p?.email || t("noteAuthorUnknown");
  }

  /** Validate + canonicalise every custom field. Returns the rows to
   *  write, or the name of the first field that failed. */
  function resolveCustomValues():
    | { ok: true; rows: { field_id: string; value: string | null }[] }
    | { ok: false; fieldName: string } {
    const rows: { field_id: string; value: string | null }[] = [];
    for (const field of dealFields) {
      const raw = fieldValues[field.id] ?? "";
      const def: DealFieldDefinition = {
        field_type: field.field_type,
        field_options: field.field_options,
      };
      const parsed = parseDealFieldValue(def, raw);
      if (!parsed.ok) {
        return { ok: false, fieldName: field.field_name };
      }
      rows.push({ field_id: field.id, value: parsed.value });
    }
    return { ok: true, rows };
  }

  async function persistCustomValues(
    dealId: string,
    rows: { field_id: string; value: string | null }[],
  ): Promise<boolean> {
    const toUpsert = rows
      .filter((r) => r.value !== null)
      .map((r) => ({ deal_id: dealId, field_id: r.field_id, value: r.value }));
    const toClear = rows.filter((r) => r.value === null).map((r) => r.field_id);

    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from("deal_custom_values")
        .upsert(toUpsert, { onConflict: "deal_id,field_id" });
      if (error) return false;
    }
    if (toClear.length > 0) {
      const { error } = await supabase
        .from("deal_custom_values")
        .delete()
        .eq("deal_id", dealId)
        .in("field_id", toClear);
      if (error) return false;
    }
    return true;
  }

  async function handleSave() {
    if (!canEdit) return;
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }

    // A `datetime-local` input's value is either "" or a complete
    // "YYYY-MM-DDTHH:mm" — this guards a date with no time slipping
    // through some other way (spec: "A date without a time is rejected").
    if (scheduledAt && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(scheduledAt)) {
      toast.error(t("toastScheduleIncomplete"));
      return;
    }

    // Validate every custom field before any write — a single bad value
    // fails the whole save (spec: "Partial save failure is surfaced").
    const resolved = resolveCustomValues();
    if (!resolved.ok) {
      toast.error(t("toastCustomFieldInvalid", { name: resolved.fieldName }));
      return;
    }

    setSaving(true);

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      scheduled_at: scheduledAt
        ? fromZonedInputValue(scheduledAt, timeZone)
        : null,
      priority: priority || null,
      source: source || null,
      description: description.trim() || null,
    };

    let dealId = deal?.id ?? null;

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const sessionUser = session?.user;
      if (!sessionUser) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      const { data: created, error } = await supabase
        .from("deals")
        .insert({
          ...payload,
          user_id: sessionUser.id,
          account_id: accountId,
          status: "open",
        })
        .select("id")
        .single();
      if (error || !created) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
      dealId = created.id;
    }

    if (dealId && resolved.rows.length > 0) {
      const ok = await persistCustomValues(dealId, resolved.rows);
      if (!ok) {
        toast.error(t("toastCustomFieldsFailed"));
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleStatusChange(status: DealStatus) {
    if (!deal || !canEdit) return;
    setStatusAction(status);
    const patch: { status: DealStatus; lost_reason?: string | null } = {
      status,
    };
    if (status === "lost") {
      patch.lost_reason = lostReason.trim() || null;
    }
    // Reopening deliberately leaves lost_reason untouched so the history
    // of why it was lost survives (spec: "Reopening preserves the reason").
    const { error } = await supabase
      .from("deals")
      .update(patch)
      .eq("id", deal.id);
    setStatusAction(null);
    if (error) {
      toast.error(t("toastFailedStatus"));
      return;
    }
    setConfirmLost(false);
    toast.success(
      status === "qualified"
        ? t("toastMarkedWon")
        : status === "lost"
          ? t("toastMarkedLost")
          : t("toastReopened"),
    );
    onOpenChange(false);
    onSaved();
  }

  async function handleAddNote() {
    if (!deal || !canEdit || !newNote.trim()) return;
    setAddingNote(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const { data, error } = await supabase
      .from("deal_notes")
      .insert({
        deal_id: deal.id,
        user_id: session?.user?.id ?? null,
        note_text: newNote.trim(),
      })
      .select("*")
      .single();
    setAddingNote(false);
    if (error || !data) {
      toast.error(t("toastNoteFailed"));
      return;
    }
    setNotes((prev) => [data as DealNote, ...prev]);
    setNewNote("");
  }

  async function handleDeleteNote(id: string) {
    if (!canEdit) return;
    const { error } = await supabase.from("deal_notes").delete().eq("id", id);
    if (error) {
      toast.error(t("toastNoteDeleteFailed"));
      return;
    }
    setNotes((prev) => prev.filter((n) => n.id !== id));
  }

  async function handleToggleArchive() {
    if (!deal || !canEdit) return;
    const nextArchived = !deal.archived_at;
    setArchiveBusy(true);
    const result = await setDealArchived(supabase, deal.id, nextArchived);
    setArchiveBusy(false);
    if (!result.ok) {
      toast.error(t("toastFailedArchive"));
      return;
    }
    toast.success(nextArchived ? t("toastArchived") : t("toastUnarchived"));
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal || !canEdit) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  const disabled = !canEdit;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground w-full p-0 sm:max-w-lg"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-border/50 border-b p-4">
            <SheetTitle className="text-popover-foreground flex items-center gap-2">
              {deal ? t("editDeal") : t("newDeal")}
              {deal?.archived_at && (
                <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
                  <Archive className="h-3 w-3" />
                  {t("archivedBadge")}
                </span>
              )}
            </SheetTitle>
          </SheetHeader>

          <Tabs defaultValue="details" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="border-border bg-muted/50 mx-4 mt-3 border-b">
              <TabsTrigger value="details" className="text-muted-foreground">
                {t("tabs.details")}
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-muted-foreground">
                {t("tabs.custom")}
              </TabsTrigger>
              <TabsTrigger
                value="notes"
                className="text-muted-foreground"
                disabled={!deal}
              >
                {t("tabs.notes")}
              </TabsTrigger>
            </TabsList>

            {/* DETAILS ------------------------------------------------ */}
            <TabsContent
              value="details"
              keepMounted
              className="flex-1 space-y-4 overflow-y-auto p-4"
            >
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("title")}</Label>
                <Input
                  value={title}
                  disabled={disabled}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("titlePlaceholder")}
                  className="border-border bg-muted text-foreground"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("contact")}</Label>
                <select
                  value={contactId}
                  disabled={disabled}
                  onChange={(e) => setContactId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("selectContact")}</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.phone}
                    </option>
                  ))}
                </select>

                {linkedConversation && (
                  <Link
                    href="/inbox"
                    className="bg-primary/10 text-primary hover:bg-primary/20 mt-1 inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs"
                  >
                    <MessageSquare className="h-3 w-3" />
                    {t("linkToConversation")}
                  </Link>
                )}
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("value")}</Label>
                <div className="relative">
                  <DollarSign className="text-muted-foreground absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2" />
                  <Input
                    type="number"
                    value={value}
                    disabled={disabled}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-border bg-muted text-foreground pl-7"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("priority")}</Label>
                <select
                  value={priority}
                  disabled={disabled}
                  onChange={(e) =>
                    setPriority(e.target.value as "" | DealPriority)
                  }
                  className={SELECT_CLASS}
                >
                  <option value="">{t("priorityUnset")}</option>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`priorities.${p}`)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("source")}</Label>
                <select
                  value={source}
                  disabled={disabled}
                  onChange={(e) => setSource(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("sourceUnset")}</option>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`sources.${s}`)}
                    </option>
                  ))}
                  {/* A legacy free-text source still shows and is kept
                      unless the user picks a new one. */}
                  {source &&
                    !SOURCES.includes(source as (typeof SOURCES)[number]) && (
                      <option value={source}>{source}</option>
                    )}
                </select>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t("description")}
                </Label>
                <Textarea
                  value={description}
                  disabled={disabled}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("descriptionPlaceholder")}
                  className="border-border bg-muted text-foreground min-h-[80px]"
                />
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t("scheduledAt")}
                </Label>
                <DateTimePicker
                  value={scheduledAt}
                  disabled={disabled}
                  onChange={setScheduledAt}
                  aria-label={t("scheduledAt")}
                  className="border-border bg-muted text-foreground w-full"
                />
              </div>

              {deal && (
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">
                    {t("pipeline")}
                  </Label>
                  <select
                    value={pipelineId}
                    disabled={disabled}
                    onChange={(e) => handlePipelineChange(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("stage")}</Label>
                <select
                  value={stageId}
                  disabled={disabled}
                  onChange={(e) => setStageId(e.target.value)}
                  className={SELECT_CLASS}
                >
                  {stageOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label className="text-muted-foreground">
                  {t("assignedTo")}
                </Label>
                <select
                  value={assignedTo}
                  disabled={disabled}
                  onChange={(e) => setAssignedTo(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">{t("unassigned")}</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {memberLabel(p, tCommon("unnamedMember"))}
                    </option>
                  ))}
                </select>
              </div>

              {deal && (
                <div className="border-border bg-muted/50 space-y-2 rounded-lg border p-3">
                  <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
                    {t("status")}
                  </p>
                  {deal.status === "lost" && deal.lost_reason && (
                    <p className="text-muted-foreground text-xs">
                      {t("lostReasonLabel")}: {deal.lost_reason}
                    </p>
                  )}
                  {confirmLost ? (
                    <div className="space-y-2">
                      <Input
                        value={lostReason}
                        onChange={(e) => setLostReason(e.target.value)}
                        placeholder={t("lostReasonPlaceholder")}
                        className="border-border bg-muted text-foreground"
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          onClick={() => handleStatusChange("lost")}
                          disabled={!!statusAction}
                          className="flex-1 bg-red-600 text-white hover:bg-red-700"
                        >
                          {statusAction === "lost" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            t("confirmLost")
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setConfirmLost(false)}
                          className="text-muted-foreground flex-1"
                        >
                          {t("cancel")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        onClick={() => handleStatusChange("qualified")}
                        disabled={
                          disabled ||
                          !!statusAction ||
                          deal.status === "qualified"
                        }
                        className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1 disabled:opacity-50"
                      >
                        {statusAction === "qualified" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="mr-1 h-4 w-4" />
                            {t("markAsWon")}
                          </>
                        )}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setConfirmLost(true)}
                        disabled={
                          disabled || !!statusAction || deal.status === "lost"
                        }
                        className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        <X className="mr-1 h-4 w-4" />
                        {t("markAsLost")}
                      </Button>
                    </div>
                  )}
                  {deal.status && deal.status !== "open" && !confirmLost && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleStatusChange("open")}
                      disabled={disabled || !!statusAction}
                      className="text-muted-foreground hover:text-foreground w-full"
                    >
                      {t("reopenDeal")}
                    </Button>
                  )}
                </div>
              )}
            </TabsContent>

            {/* CUSTOM FIELDS ---------------------------------------- */}
            <TabsContent
              value="custom"
              keepMounted
              className="flex-1 space-y-4 overflow-y-auto p-4"
            >
              {dealFields.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("noCustomFields")}
                </p>
              ) : (
                dealFields.map((field) => (
                  <CustomFieldControl
                    key={field.id}
                    field={field}
                    value={fieldValues[field.id] ?? ""}
                    disabled={disabled}
                    onChange={(v) =>
                      setFieldValues((prev) => ({ ...prev, [field.id]: v }))
                    }
                    notSetLabel={t("customNotSet")}
                  />
                ))
              )}
            </TabsContent>

            {/* NOTES ---------------------------------------------- */}
            <TabsContent
              value="notes"
              keepMounted
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4"
            >
              {!deal ? (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  {t("notesAfterSave")}
                </p>
              ) : (
                <>
                  {canEdit && (
                    <div className="space-y-2">
                      <Textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder={t("notePlaceholder")}
                        className="border-border bg-muted text-foreground min-h-[60px] resize-none"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddNote}
                        disabled={addingNote || !newNote.trim()}
                        className="bg-primary text-primary-foreground hover:bg-primary/90"
                      >
                        {addingNote ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Plus className="h-3.5 w-3.5" />
                        )}
                        {t("addNote")}
                      </Button>
                    </div>
                  )}

                  <div className="flex-1 space-y-2">
                    {notes.length === 0 ? (
                      <p className="text-muted-foreground py-8 text-center text-sm">
                        {t("noNotes")}
                      </p>
                    ) : (
                      notes.map((note) => (
                        <div
                          key={note.id}
                          className="group border-border/50 bg-muted/50 rounded-lg border p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-muted-foreground flex-1 text-sm whitespace-pre-wrap">
                              {note.note_text}
                            </p>
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => handleDeleteNote(note.id)}
                                className="text-muted-foreground shrink-0 opacity-0 transition-all group-hover:opacity-100 hover:text-red-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <p className="text-muted-foreground mt-1.5 text-xs">
                            {authorName(note.user_id)} ·{" "}
                            {formatDate(note.created_at, undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          <div className="border-border/50 bg-popover/80 border-t p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground hover:bg-muted flex-1 bg-transparent"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={
                  disabled || saving || !title.trim() || !contactId || !stageId
                }
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex-1"
              >
                {saving
                  ? t("saving")
                  : deal
                    ? t("saveChanges")
                    : t("createDeal")}
              </Button>
            </div>

            {deal && canEdit && (
              <Button
                type="button"
                variant="outline"
                onClick={handleToggleArchive}
                disabled={archiveBusy}
                className="border-border text-muted-foreground hover:bg-muted mt-3 w-full bg-transparent"
              >
                {archiveBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : deal.archived_at ? (
                  <ArchiveRestore className="h-4 w-4" />
                ) : (
                  <Archive className="h-4 w-4" />
                )}
                {deal.archived_at ? t("unarchive") : t("archive")}
              </Button>
            )}

            {deal &&
              canEdit &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="text-muted-foreground hover:bg-muted rounded px-2 py-1"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CustomFieldControl({
  field,
  value,
  disabled,
  onChange,
  notSetLabel,
}: {
  field: DealCustomField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  notSetLabel: string;
}) {
  const options = field.field_options?.options ?? [];

  return (
    <div className="grid gap-2">
      <Label className="text-muted-foreground">{field.field_name}</Label>

      {field.field_type === "checkbox" ? (
        <label className="text-foreground flex items-center gap-2 text-sm">
          <Checkbox
            checked={value === "true"}
            disabled={disabled}
            onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          />
          {field.field_name}
        </label>
      ) : field.field_type === "select" ? (
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{notSetLabel}</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          {/* A stored value no longer in the options list still shows. */}
          {value && !options.includes(value) && (
            <option value={value}>{value}</option>
          )}
        </select>
      ) : (
        <Input
          type={
            field.field_type === "number"
              ? "number"
              : field.field_type === "date"
                ? "date"
                : "text"
          }
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="border-border bg-muted text-foreground"
        />
      )}
    </div>
  );
}
