import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from "date-fns";
import { fromZonedInputValue, toZonedInputValue } from "@/lib/time/account-tz";

export type Period = "month" | "week";

/**
 * Today's calendar date in `timeZone`, as a `Date` whose own (browser-
 * local) year/month/day fields match it. Every other helper here builds
 * on Dates constructed this way, so date-fns' local-field arithmetic
 * (`addMonths`, `startOfWeek`, ...) stays in the account's calendar
 * regardless of what timezone the browser itself is in.
 */
export function accountToday(timeZone: string): Date {
  const [y, m, d] = toZonedInputValue(new Date().toISOString(), timeZone)
    .slice(0, 10)
    .split("-")
    .map(Number);
  return new Date(y, m - 1, d);
}

export function shiftAnchor(anchor: Date, period: Period, dir: 1 | -1): Date {
  if (period === "month") {
    return dir === 1 ? addMonths(anchor, 1) : subMonths(anchor, 1);
  }
  return dir === 1 ? addWeeks(anchor, 1) : subWeeks(anchor, 1);
}

/**
 * The full grid range for `period` around `anchor`. The month view's
 * grid includes the leading/trailing days of adjacent months that fill
 * out the first/last week rows.
 */
export function gridRange(
  anchor: Date,
  period: Period,
): { start: Date; end: Date } {
  if (period === "month") {
    return {
      start: startOfWeek(startOfMonth(anchor)),
      end: endOfWeek(endOfMonth(anchor)),
    };
  }
  return { start: startOfWeek(anchor), end: endOfWeek(anchor) };
}

/**
 * "YYYY-MM-DD" from a Date's own local fields. Comparable with
 * {@link accountDayKey} because every Date this module produces is
 * built from account-timezone Y-M-D components (see {@link accountToday}),
 * not from real time — so the two never disagree regardless of the
 * browser's own timezone.
 */
export function gridDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The account-timezone calendar day a stored instant falls on. */
export function accountDayKey(iso: string, timeZone: string): string {
  return toZonedInputValue(iso, timeZone).slice(0, 10);
}

/**
 * UTC instant bounds covering `range`'s calendar days in `timeZone`, as
 * a `[start, end)` half-open interval — the bounds a `scheduled_at`
 * query filters on so the calendar only loads the visible period.
 */
export function rangeToUtcBounds(
  range: { start: Date; end: Date },
  timeZone: string,
): { startIso: string; endIso: string } {
  const startIso = fromZonedInputValue(
    `${gridDayKey(range.start)}T00:00`,
    timeZone,
  );
  const endIso = fromZonedInputValue(
    `${gridDayKey(addDays(range.end, 1))}T00:00`,
    timeZone,
  );
  return { startIso, endIso };
}

/** The booked time of day, rendered in `timeZone`. */
export function formatTimeOfDay(
  iso: string,
  timeZone: string,
  locale: string,
): string {
  return new Date(iso).toLocaleTimeString(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}
