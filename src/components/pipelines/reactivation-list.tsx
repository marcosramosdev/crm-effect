"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Clock, Loader2, UserRound } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { PipelineStage } from "@/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ReactivationRow {
  id: string;
  title: string;
  stageId: string;
  conversationId: string;
  contactName: string | null;
  daysSinceLastMessage: number;
  hasFutureAppointment: boolean;
}

type FutureFilter = "any" | "has" | "none";
const ANY_STAGE = "__any_stage__";

interface RawDealRow {
  id: string;
  title: string;
  stage_id: string;
  scheduled_at: string | null;
  contact:
    | { name: string | null }
    | { name: string | null }[]
    | null;
  conversation:
    | { id: string; last_message_at: string | null }
    | { id: string; last_message_at: string | null }[]
    | null;
}

function firstOf<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : (value ?? null);
}

/**
 * "Reactivation" tab — leads that went quiet, alongside the pipeline
 * board (specs/followups/spec.md, "The account can list the leads
 * that went quiet"). A single filtered query, no materialised view
 * (design.md D12 — fine at clinic scale). Strictly read-only: opening
 * or filtering never moves a deal, and there is no multi-select or
 * bulk action — only "open this one lead's conversation".
 */
export function ReactivationList({
  pipelineId,
  stages,
}: {
  pipelineId: string;
  stages: PipelineStage[];
}) {
  const t = useTranslations("Pipelines.reactivation");
  const router = useRouter();
  const { accountId } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReactivationRow[]>([]);
  const [days, setDays] = useState<number | null>(null);
  const [stageFilter, setStageFilter] = useState<string>(ANY_STAGE);
  const [futureFilter, setFutureFilter] = useState<FutureFilter>("any");

  useEffect(() => {
    if (!accountId || !pipelineId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const [{ data: acct }, { data: deals, error }] = await Promise.all([
        supabase
          .from("accounts")
          .select("stale_lead_days")
          .eq("id", accountId)
          .maybeSingle(),
        supabase
          .from("deals")
          .select(
            "id, title, stage_id, scheduled_at, contact:contacts(name), conversation:conversations(id, last_message_at)",
          )
          .eq("pipeline_id", pipelineId)
          .is("archived_at", null),
      ]);
      if (cancelled) return;
      if (error) {
        console.error("[reactivation] load failed:", error.message);
        setLoading(false);
        return;
      }

      const now = Date.now();
      const mapped: ReactivationRow[] = [];
      for (const raw of (deals ?? []) as unknown as RawDealRow[]) {
        const conversation = firstOf(raw.conversation);
        // A deal with no conversation has no "days without contact" —
        // it never had contact to begin with, so it isn't a lead that
        // "went quiet".
        if (!conversation?.last_message_at) continue;
        const contact = firstOf(raw.contact);
        const daysSince = Math.floor(
          (now - new Date(conversation.last_message_at).getTime()) / 86_400_000,
        );
        mapped.push({
          id: raw.id,
          title: raw.title,
          stageId: raw.stage_id,
          conversationId: conversation.id,
          contactName: contact?.name ?? null,
          daysSinceLastMessage: daysSince,
          hasFutureAppointment:
            !!raw.scheduled_at && new Date(raw.scheduled_at).getTime() > now,
        });
      }
      setRows(mapped);
      setDays((prev) => prev ?? acct?.stale_lead_days ?? 15);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, pipelineId]);

  const filtered = useMemo(() => {
    if (days === null) return [];
    return rows
      .filter((r) => r.daysSinceLastMessage >= days)
      .filter((r) => stageFilter === ANY_STAGE || r.stageId === stageFilter)
      .filter((r) => {
        if (futureFilter === "has") return r.hasFutureAppointment;
        if (futureFilter === "none") return !r.hasFutureAppointment;
        return true;
      })
      .sort((a, b) => b.daysSinceLastMessage - a.daysSinceLastMessage);
  }, [rows, days, stageFilter, futureFilter]);

  const stageName = (stageId: string) =>
    stages.find((s) => s.id === stageId)?.name ?? "";

  if (loading || days === null) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-primary h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">
            {t("daysLabel")}
          </Label>
          <Input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Math.max(1, Number(e.target.value) || 1))}
            className="bg-muted border-border text-foreground w-24"
          />
        </div>

        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">
            {t("stageLabel")}
          </Label>
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v ?? ANY_STAGE)}>
            <SelectTrigger className="bg-muted border-border text-foreground w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_STAGE}>{t("anyStage")}</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-1.5">
          <Label className="text-muted-foreground text-xs">
            {t("appointmentLabel")}
          </Label>
          <Select
            value={futureFilter}
            onValueChange={(v) => setFutureFilter((v as FutureFilter) ?? "any")}
          >
            <SelectTrigger className="bg-muted border-border text-foreground w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">{t("appointmentAny")}</SelectItem>
              <SelectItem value="has">{t("appointmentHas")}</SelectItem>
              <SelectItem value="none">{t("appointmentNone")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground ml-auto text-sm">
          {t("count", { count: filtered.length })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
          <Clock className="text-muted-foreground h-8 w-8" />
          <p className="text-muted-foreground mt-3 text-sm">{t("empty")}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => router.push(`/inbox?c=${row.conversationId}`)}
                className="border-border bg-card hover:border-primary/40 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors"
              >
                <div className="bg-muted flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full">
                  <UserRound className="text-muted-foreground h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">
                    {row.contactName || row.title}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {stageName(row.stageId)}
                  </p>
                </div>
                <span className="text-muted-foreground flex-shrink-0 text-xs">
                  {t("daysAgo", { count: row.daysSinceLastMessage })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
