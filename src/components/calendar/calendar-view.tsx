"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dateFnsLocale } from "@/i18n/date-fns-locale";
import { MonthGrid } from "./month-grid";
import { WeekGrid } from "./week-grid";
import { accountDayKey, accountToday, gridRange, shiftAnchor } from "./period";
import type { Period } from "./period";
import type { CalendarEntry } from "./types";

interface CalendarViewProps {
  period: Period;
  onPeriodChange: (period: Period) => void;
  anchor: Date;
  onAnchorChange: (anchor: Date) => void;
  entries: CalendarEntry[];
  loading: boolean;
  onEntryClick: (entry: CalendarEntry) => void;
  timeZone: string;
}

export function CalendarView({
  period,
  onPeriodChange,
  anchor,
  onAnchorChange,
  entries,
  loading,
  onEntryClick,
  timeZone,
}: CalendarViewProps) {
  const t = useTranslations("Calendar");
  const locale = useLocale();
  const dfLocale = dateFnsLocale(locale);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = accountDayKey(entry.scheduledAt, timeZone);
      const bucket = map.get(key);
      if (bucket) bucket.push(entry);
      else map.set(key, [entry]);
    }
    for (const bucket of map.values()) {
      bucket.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    }
    return map;
  }, [entries, timeZone]);

  const range = gridRange(anchor, period);
  const label =
    period === "month"
      ? format(anchor, "MMMM yyyy", { locale: dfLocale })
      : `${format(range.start, "MMM d", { locale: dfLocale })} – ${format(
          range.end,
          "MMM d, yyyy",
          { locale: dfLocale },
        )}`;

  return (
    <div className="flex flex-col">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("previousPeriod")}
            onClick={() => onAnchorChange(shiftAnchor(anchor, period, -1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("nextPeriod")}
            onClick={() => onAnchorChange(shiftAnchor(anchor, period, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onAnchorChange(accountToday(timeZone))}
          >
            {t("today")}
          </Button>
          <span className="text-foreground text-sm font-semibold">
            {label}
          </span>
        </div>
        <div className="border-border flex items-center gap-1 rounded-md border p-0.5">
          {(["month", "week"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPeriodChange(p)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                period === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(p)}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="text-muted-foreground py-12 text-center text-sm">
            {t("loading")}
          </div>
        ) : (
          <>
            {period === "month" ? (
              <MonthGrid
                anchor={anchor}
                byDay={byDay}
                onEntryClick={onEntryClick}
                timeZone={timeZone}
              />
            ) : (
              <WeekGrid
                anchor={anchor}
                byDay={byDay}
                onEntryClick={onEntryClick}
                timeZone={timeZone}
              />
            )}
            {entries.length === 0 && (
              <p className="text-muted-foreground mt-3 text-center text-sm">
                {t("emptyPeriod")}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
