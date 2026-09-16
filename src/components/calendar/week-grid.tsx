"use client";

import { eachDayOfInterval, format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { dateFnsLocale } from "@/i18n/date-fns-locale";
import { gridDayKey, gridRange, formatTimeOfDay } from "./period";
import type { CalendarEntry } from "./types";

interface WeekGridProps {
  anchor: Date;
  byDay: Map<string, CalendarEntry[]>;
  onEntryClick: (entry: CalendarEntry) => void;
  timeZone: string;
}

export function WeekGrid({
  anchor,
  byDay,
  onEntryClick,
  timeZone,
}: WeekGridProps) {
  const t = useTranslations("Calendar");
  const locale = useLocale();
  const dfLocale = dateFnsLocale(locale);
  const days = eachDayOfInterval(gridRange(anchor, "week"));

  return (
    <div className="space-y-3">
      {days.map((day) => {
        const key = gridDayKey(day);
        const dayEntries = byDay.get(key) ?? [];
        return (
          <div key={key} className="border-border rounded-lg border">
            <div className="border-border bg-muted/50 text-foreground border-b px-3 py-1.5 text-xs font-semibold">
              {format(day, "EEEE, MMM d", { locale: dfLocale })}
            </div>
            {dayEntries.length === 0 ? (
              <p className="text-muted-foreground px-3 py-2 text-xs">
                {t("noAppointments")}
              </p>
            ) : (
              <ul className="divide-border divide-y">
                {dayEntries.map((entry) => (
                  <li key={entry.dealId}>
                    <button
                      type="button"
                      onClick={() => onEntryClick(entry)}
                      className="hover:bg-muted flex w-full items-center gap-3 px-3 py-2 text-left text-sm"
                    >
                      <span className="text-primary text-xs font-semibold">
                        {formatTimeOfDay(entry.scheduledAt, timeZone, locale)}
                      </span>
                      <span className="text-foreground truncate">
                        {entry.leadName}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
