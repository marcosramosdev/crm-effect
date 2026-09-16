"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CalendarView } from "@/components/calendar/calendar-view";
import { accountToday, gridRange, rangeToUtcBounds } from "@/components/calendar/period";
import type { Period } from "@/components/calendar/period";
import type { CalendarEntry } from "@/components/calendar/types";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealRow {
  id: string;
  scheduled_at: string;
  conversation_id: string | null;
  contact: { name: string | null; phone: string | null } | null;
}

export default function CalendarPage() {
  const t = useTranslations("Calendar");
  const router = useRouter();
  const supabase = createClient();
  const { accountId, timeZone } = useAuth();

  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState<Date>(() => accountToday(timeZone));
  const [entries, setEntries] = useState<CalendarEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    const { startIso, endIso } = rangeToUtcBounds(
      gridRange(anchor, period),
      timeZone,
    );
    // Read-only agenda over `deals`, across every pipeline in the
    // account (no `.eq("pipeline_id", ...)`) — RLS already scopes rows
    // to the caller's account.
    const { data, error } = await supabase
      .from("deals")
      .select("id, scheduled_at, conversation_id, contact:contacts(name, phone)")
      .not("scheduled_at", "is", null)
      .is("archived_at", null)
      .gte("scheduled_at", startIso)
      .lt("scheduled_at", endIso)
      .order("scheduled_at");
    setLoading(false);
    if (error) {
      console.error("Failed to load calendar deals:", error.message);
      toast.error(t("toastFailedLoad"));
      return;
    }
    const rows = (data ?? []) as unknown as DealRow[];
    setEntries(
      rows
        .filter((r): r is DealRow & { scheduled_at: string } => !!r.scheduled_at)
        .map((r) => ({
          dealId: r.id,
          leadName: r.contact?.name || r.contact?.phone || t("noLeadName"),
          scheduledAt: r.scheduled_at,
          conversationId: r.conversation_id,
        })),
    );
  }, [supabase, anchor, period, timeZone, t]);

  useEffect(() => {
    if (!accountId) return;
    loadEntries();
  }, [accountId, loadEntries]);

  function handleEntryClick(entry: CalendarEntry) {
    if (entry.conversationId) {
      router.push(`/inbox?c=${entry.conversationId}`);
    } else {
      toast.error(t("toastNoConversation"));
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t("title")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>
      <div className="border-border bg-card overflow-hidden rounded-xl border">
        <CalendarView
          period={period}
          onPeriodChange={setPeriod}
          anchor={anchor}
          onAnchorChange={setAnchor}
          entries={entries}
          loading={loading}
          onEntryClick={handleEntryClick}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}
