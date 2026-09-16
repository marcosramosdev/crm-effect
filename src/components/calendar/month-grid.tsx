"use client";

import { addDays, eachDayOfInterval, format, isSameMonth } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { dateFnsLocale } from "@/i18n/date-fns-locale";
import { gridDayKey, gridRange, formatTimeOfDay } from "./period";
import type { CalendarEntry } from "./types";

const MAX_VISIBLE_PER_DAY = 3;

interface MonthGridProps {
  anchor: Date;
  byDay: Map<string, CalendarEntry[]>;
  onEntryClick: (entry: CalendarEntry) => void;
  timeZone: string;
}

export function MonthGrid({
  anchor,
  byDay,
  onEntryClick,
  timeZone,
}: MonthGridProps) {
  const t = useTranslations("Calendar");
  const locale = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const range = gridRange(anchor, "month");
  const days = eachDayOfInterval(range);
  const weekdayLabels = Array.from({ length: 7 }, (_, i) =>
    format(addDays(range.start, i), "EEEEEE", { locale: dfLocale }),
  );

  return (
    <div className="border-border grid grid-cols-7 gap-px overflow-hidden rounded-lg border">
      {weekdayLabels.map((label, i) => (
        <div
          key={i}
          className="bg-muted text-muted-foreground px-2 py-1.5 text-center text-[11px] font-semibold uppercase"
        >
          {label}
        </div>
      ))}
      {days.map((day) => {
        const key = gridDayKey(day);
        const dayEntries = byDay.get(key) ?? [];
        const visible = dayEntries.slice(0, MAX_VISIBLE_PER_DAY);
        const overflow = dayEntries.length - visible.length;
        return (
          <div
            key={key}
            className={cn(
              "bg-card min-h-24 space-y-1 p-1.5 text-left",
              !isSameMonth(day, anchor) && "opacity-40",
            )}
          >
            <span className="text-muted-foreground text-[11px] font-medium">
              {day.getDate()}
            </span>
            {visible.map((entry) => (
              <button
                key={entry.dealId}
                type="button"
                onClick={() => onEntryClick(entry)}
                className="bg-primary/10 text-primary hover:bg-primary/20 block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium"
              >
                {formatTimeOfDay(entry.scheduledAt, timeZone, locale)}{" "}
                {entry.leadName}
              </button>
            ))}
            {overflow > 0 && (
              <span className="text-muted-foreground block text-[10px]">
                {t("moreCount", { count: overflow })}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
