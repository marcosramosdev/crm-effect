"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarIcon, X as ClearIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { APP_LOCALE, formatDateTime } from "@/lib/format";
import { dateFnsLocale } from "@/i18n/date-fns-locale";

/**
 * Wall-clock value both `datetime-local` inputs used:
 * "YYYY-MM-DDTHH:mm", or "" for no schedule. Callers keep converting
 * this against the account timezone with `toZonedInputValue` /
 * `fromZonedInputValue` exactly as before — this control only decides
 * how the value is picked, not what it means.
 */
type WallClockValue = string;

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, "0"));
const DEFAULT_HOUR = "09";
const DEFAULT_MINUTE = "00";

export function minuteOptions(current: string): string[] {
  const grid = Array.from({ length: 12 }, (_, m) =>
    String(m * 5).padStart(2, "0"),
  );
  // Preserve an off-grid minute already on the value (e.g. an existing
  // appointment at :37) instead of silently rounding it away.
  if (current && !grid.includes(current)) {
    return [...grid, current].sort();
  }
  return grid;
}

export function parseValue(value: WallClockValue) {
  if (!value) return { date: undefined as Date | undefined, hour: "", minute: "" };
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [hour = "", minute = ""] = (timePart ?? "").split(":");
  return { date: new Date(y, m - 1, d), hour, minute };
}

export function buildValue(
  date: Date | undefined,
  hour: string,
  minute: string,
): WallClockValue {
  if (!date || !hour || !minute) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}T${hour}:${minute}`;
}

interface DateTimeFieldsProps {
  value: WallClockValue;
  onChange: (value: WallClockValue) => void;
  disabled?: boolean;
}

/**
 * The calendar + hour/minute selects, with no popover of their own —
 * for a caller (like the board card) that already owns a Popover to
 * put them in.
 */
export function DateTimeFields({
  value,
  onChange,
  disabled,
}: DateTimeFieldsProps) {
  const t = useTranslations("DateTimePicker");
  const { date, hour, minute } = parseValue(value);

  return (
    <div className="flex flex-col gap-2">
      <Calendar
        mode="single"
        selected={date}
        locale={dateFnsLocale(APP_LOCALE)}
        disabled={disabled}
        onSelect={(d) =>
          onChange(d ? buildValue(d, hour || DEFAULT_HOUR, minute || DEFAULT_MINUTE) : "")
        }
      />
      <div className="flex items-center justify-center gap-1.5 px-1 pb-1">
        <Select
          value={hour || DEFAULT_HOUR}
          onValueChange={(h) =>
            onChange(buildValue(date, h ?? DEFAULT_HOUR, minute || DEFAULT_MINUTE))
          }
          disabled={disabled || !date}
        >
          <SelectTrigger className="w-[4.5rem]" aria-label={t("hour")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOURS.map((h) => (
              <SelectItem key={h} value={h}>
                {h}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">:</span>
        <Select
          value={minute || DEFAULT_MINUTE}
          onValueChange={(m) =>
            onChange(buildValue(date, hour || DEFAULT_HOUR, m ?? DEFAULT_MINUTE))
          }
          disabled={disabled || !date}
        >
          <SelectTrigger className="w-[4.5rem]" aria-label={t("minute")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {minuteOptions(minute).map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

interface DateTimePickerProps {
  value: WallClockValue;
  onChange: (value: WallClockValue) => void;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Self-contained date-and-time picker: a trigger button showing the
 * chosen value (or a placeholder), opening {@link DateTimeFields} in a
 * popover. For a caller that has no popover of its own — the deal
 * form's scheduling field.
 */
export function DateTimePicker({
  value,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: DateTimePickerProps) {
  const t = useTranslations("DateTimePicker");
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn("justify-start font-normal", className)}
          />
        }
      >
        <CalendarIcon className="h-4 w-4" />
        {value ? formatDateTime(value) : t("pickDate")}
        {value && !disabled && (
          <span
            role="button"
            tabIndex={0}
            aria-label={t("clear")}
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                e.preventDefault();
                onChange("");
              }
            }}
            className="hover:text-foreground text-muted-foreground ml-auto inline-flex"
          >
            <ClearIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto items-start">
        <DateTimeFields value={value} onChange={onChange} disabled={disabled} />
      </PopoverContent>
    </Popover>
  );
}
