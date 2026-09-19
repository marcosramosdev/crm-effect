"use client";

import { useEffect, useRef, useState } from "react";
import type { Deal, PipelineStage } from "@/types";
import {
  Archive,
  ArchiveRestore,
  Calendar,
  Check,
  Megaphone,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DateTimeFields } from "@/components/ui/date-time-picker";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { useCan } from "@/hooks/use-can";
import { useAuth } from "@/hooks/use-auth";
import { fromZonedInputValue, toZonedInputValue } from "@/lib/time/account-tz";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
  /** Persist an inline title / value / schedule edit, or the Meta
   *  conversion mark. Optimistic + revert is the caller's job;
   *  resolves `true` on success. Absent → no inline edit. */
  onInlineSave?: (
    dealId: string,
    patch: {
      title?: string;
      value?: number;
      scheduled_at?: string | null;
      meta_qualified_at?: string | null;
    },
  ) => Promise<boolean>;
  /** Told when inline editing (title/value form, schedule popover, or
   *  the archive confirm strip) starts / stops so the draggable wrapper
   *  can drop its drag listeners while a control is active. */
  onEditingChange?: (editing: boolean) => void;
  /** Archive this deal (default variant, hover action behind a confirm
   *  step). Absent → no archive affordance. */
  onArchive?: (dealId: string) => void;
  /** Restore this deal (archived variant only). */
  onUnarchive?: (dealId: string) => void;
  /** `"archived"` = this card is in the archived-deals review view: no
   *  drag, no inline edit, no re-archive — only Unarchive. */
  variant?: "default" | "archived";
}

/** Render a stored UTC instant as the booked time of day, in `timeZone`. */
function formatScheduled(iso: string, timeZone: string) {
  return formatDate(iso, undefined, {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({
  deal,
  stage,
  onEdit,
  isOverlay,
  onInlineSave,
  onEditingChange,
  onArchive,
  onUnarchive,
  variant = "default",
}: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const canEdit = useCan("send-messages");
  const { timeZone } = useAuth();
  const isArchivedView = variant === "archived";
  const contactLabel =
    deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(deal.title);
  const [draftValue, setDraftValue] = useState(String(deal.value ?? ""));
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // Schedule popover.
  const [dateOpen, setDateOpen] = useState(false);
  const [draftScheduled, setDraftScheduled] = useState(
    deal.scheduled_at ? toZonedInputValue(deal.scheduled_at, timeZone) : "",
  );
  const [savingDate, setSavingDate] = useState(false);

  // Archive confirm strip (mirrors deal-form.tsx's delete confirm).
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Meta conversion mark (migration 049). No confirm step: it is
  // reversible in one click, unlike archiving, which removes the card.
  const [marking, setMarking] = useState(false);
  const marked = !!deal.meta_qualified_at;

  const canInline = !!onInlineSave && !isOverlay && canEdit && !isArchivedView;
  const inlineEnabled = canInline;
  const dateEditEnabled = canInline;
  const archiveEnabled =
    !!onArchive && !isOverlay && canEdit && !isArchivedView;
  // Only an ad-originated contact has a conversion to report, so only
  // those cards get the control — a toggle wired to nothing is worse
  // than no toggle (design.md D7 of meta-capi-manual-qualification).
  const markEnabled = canInline && !!deal.contact?.ctwa_clid;

  // Any active inline control drops the drag listeners.
  const busy = editing || dateOpen || confirmArchive;

  useEffect(() => {
    onEditingChange?.(busy);
  }, [busy, onEditingChange]);

  function startEditing(e: React.MouseEvent) {
    e.stopPropagation();
    setDraftTitle(deal.title);
    setDraftValue(String(deal.value ?? ""));
    setEditing(true);
    // focus the title once the input is mounted
    requestAnimationFrame(() => titleRef.current?.select());
  }

  function cancelEditing() {
    setEditing(false);
  }

  async function commitEditing() {
    if (!onInlineSave) return;
    const title = draftTitle.trim();
    const value = parseFloat(draftValue);
    const patch: { title?: string; value?: number } = {};
    if (title && title !== deal.title) patch.title = title;
    if (!Number.isNaN(value) && value !== deal.value) patch.value = value;

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    await onInlineSave(deal.id, patch);
    setSaving(false);
    setEditing(false);
  }

  async function commitSchedule(nextIso: string | null) {
    if (!onInlineSave) return;
    const currentIso = deal.scheduled_at ?? null;
    const unchanged =
      nextIso === currentIso ||
      (nextIso !== null &&
        currentIso !== null &&
        new Date(nextIso).getTime() === new Date(currentIso).getTime());
    if (unchanged) {
      setDateOpen(false);
      return;
    }
    setSavingDate(true);
    await onInlineSave(deal.id, { scheduled_at: nextIso });
    setSavingDate(false);
    setDateOpen(false);
  }

  async function toggleMark(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onInlineSave || marking) return;
    setMarking(true);
    await onInlineSave(deal.id, {
      meta_qualified_at: marked ? null : new Date().toISOString(),
    });
    setMarking(false);
  }

  function handleConfirmArchive(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onArchive) return;
    setArchiving(true);
    // The page removes the card optimistically, so this component
    // unmounts on success; on failure the card returns and the strip
    // is already dismissed.
    onArchive(deal.id);
    setConfirmArchive(false);
  }

  return (
    <div
      role={busy ? undefined : "button"}
      tabIndex={busy || isOverlay ? undefined : 0}
      onClick={(e) => {
        if (isOverlay || busy) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      onKeyDown={(e) => {
        if (busy || isOverlay) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(deal);
        }
      }}
      className={`group border-border/50 bg-muted/70 relative w-full rounded-xl border py-3 pr-3 pl-4 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : busy
            ? ""
            : "hover:border-border hover:bg-muted cursor-pointer hover:-translate-y-0.5 hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute top-0 left-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      {(inlineEnabled || archiveEnabled || markEnabled) && !busy && (
        <div className="absolute top-2 right-2 flex gap-0.5">
          {markEnabled && (
            <button
              type="button"
              aria-label={marked ? t("unmarkConversion") : t("markConversion")}
              aria-pressed={marked}
              title={marked ? t("unmarkConversion") : t("markConversion")}
              disabled={marking}
              onClick={toggleMark}
              className={`hover:bg-background rounded-md p-1 transition-opacity disabled:opacity-40 ${
                marked
                  ? "text-primary opacity-100"
                  : "text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              }`}
            >
              <Megaphone className="h-3.5 w-3.5" />
            </button>
          )}
          {archiveEnabled && (
            <button
              type="button"
              aria-label={t("archive")}
              onClick={(e) => {
                e.stopPropagation();
                setConfirmArchive(true);
              }}
              className="text-muted-foreground hover:bg-background rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400 focus-visible:opacity-100"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {inlineEnabled && (
            <button
              type="button"
              aria-label={t("editInline")}
              onClick={startEditing}
              className="text-muted-foreground hover:bg-background hover:text-foreground rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {editing ? (
        <div
          className="space-y-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              cancelEditing();
            }
          }}
          onBlur={(e) => {
            // Commit only when focus leaves the whole editing region.
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              void commitEditing();
            }
          }}
        >
          <input
            ref={titleRef}
            value={draftTitle}
            disabled={saving}
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitEditing();
              }
            }}
            aria-label={t("editTitleAria")}
            className="border-border bg-background text-foreground focus:border-primary w-full rounded-md border px-2 py-1 text-sm font-semibold outline-none"
          />
          <input
            type="number"
            value={draftValue}
            disabled={saving}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commitEditing();
              }
            }}
            aria-label={t("editValueAria")}
            className="border-border bg-background text-foreground focus:border-primary w-full rounded-md border px-2 py-1 text-sm outline-none"
          />
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <h4 className="text-foreground flex-1 text-sm leading-snug font-semibold break-words">
              {deal.title}
            </h4>
            {deal.status === "qualified" && (
              <span className="bg-primary/15 text-primary inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                <Check className="h-3 w-3" />
                {t("qualified")}
              </span>
            )}
            {deal.status === "lost" && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                <X className="h-3 w-3" />
                {t("lost")}
              </span>
            )}
            {/* The conversion mark is not the status: a qualified deal
                and a reported one have to be distinguishable at a
                glance, so this badge stays visible without hovering
                and never borrows the status badge's Check. */}
            {marked && (
              <span
                title={t("markedConversionTitle")}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400"
              >
                <Megaphone className="h-3 w-3" />
                {t("markedConversion")}
              </span>
            )}
          </div>

          {/* Contact row */}
          <div className="mt-2 flex items-center gap-2">
            <span className="bg-muted text-foreground flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold">
              {initials(deal.contact?.name, deal.contact?.phone)}
            </span>
            <span className="text-muted-foreground truncate text-xs">
              {contactLabel}
            </span>
          </div>

          <div className="mt-2 flex items-center justify-between">
            <span className="text-primary text-sm font-bold">
              {formatCurrency(deal.value, deal.currency)}
            </span>
            {dateEditEnabled ? (
              <Popover
                open={dateOpen}
                onOpenChange={(o) => {
                  if (o)
                    setDraftScheduled(
                      deal.scheduled_at
                        ? toZonedInputValue(deal.scheduled_at, timeZone)
                        : "",
                    );
                  setDateOpen(o);
                }}
              >
                <PopoverTrigger
                  render={
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:bg-background hover:text-foreground flex items-center gap-1 rounded-md px-1 py-0.5 text-[11px]"
                    />
                  }
                >
                  <Calendar className="h-3 w-3" />
                  {deal.scheduled_at ? (
                    formatScheduled(deal.scheduled_at, timeZone)
                  ) : (
                    <span className="inline-flex items-center gap-0.5">
                      <Plus className="h-2.5 w-2.5" />
                      {t("setSchedule")}
                    </span>
                  )}
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-auto items-start"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DateTimeFields
                    value={draftScheduled}
                    disabled={savingDate}
                    onChange={(v) => {
                      setDraftScheduled(v);
                      if (v) void commitSchedule(fromZonedInputValue(v, timeZone));
                    }}
                  />
                  <button
                    type="button"
                    disabled={savingDate || !deal.scheduled_at}
                    onClick={() => void commitSchedule(null)}
                    className="text-muted-foreground hover:text-foreground text-xs disabled:opacity-40"
                  >
                    {t("clearSchedule")}
                  </button>
                </PopoverContent>
              </Popover>
            ) : (
              deal.scheduled_at && (
                <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
                  <Calendar className="h-3 w-3" />
                  {formatScheduled(deal.scheduled_at, timeZone)}
                </span>
              )
            )}
          </div>

          {assigneeLabel && (
            <div className="mt-2 flex items-center justify-end">
              <span
                title={assigneeLabel}
                className="bg-primary/15 text-primary flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
              >
                {initials(assigneeLabel)}
              </span>
            </div>
          )}

          {isArchivedView && onUnarchive && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUnarchive(deal.id);
              }}
              className="border-border bg-background text-muted-foreground hover:text-foreground mt-2 flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              {t("unarchive")}
            </button>
          )}

          {confirmArchive && (
            <div
              className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="text-red-300">{t("confirmArchivePrompt")}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmArchive(false);
                  }}
                  className="text-muted-foreground hover:bg-muted rounded px-2 py-1"
                >
                  {t("cancelArchive")}
                </button>
                <button
                  type="button"
                  disabled={archiving}
                  onClick={handleConfirmArchive}
                  className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {t("confirmArchive")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
