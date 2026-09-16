/**
 * account-tz — convert between a stored UTC instant and the
 * wall-clock value an operator sees, against the account's IANA
 * timezone rather than the device's.
 *
 * `scheduled_at` stores an absolute instant (TIMESTAMPTZ); these two
 * functions are the round trip between that instant and the
 * `datetime-local` input's wall-clock string, both against the same
 * zone, so a booking reads the same time of day for every member of
 * the account regardless of device timezone.
 */

/** Falls back here when an account row hasn't set a timezone yet. */
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  // Some ICU builds report midnight as hour "24" under h23 — normalize.
  const hour = map.hour === "24" ? "00" : map.hour;
  const asIfUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second),
  );
  return asIfUtc - utcMs;
}

/**
 * A stored UTC instant → the `YYYY-MM-DDTHH:mm` string a
 * `datetime-local` input wants, showing the wall-clock time in
 * `timeZone`.
 */
export function toZonedInputValue(iso: string, timeZone: string): string {
  const utcMs = new Date(iso).getTime();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}

/**
 * A `datetime-local` value (`YYYY-MM-DDTHH:mm`) meant as wall-clock
 * time in `timeZone` → the UTC ISO instant it corresponds to.
 *
 * `utcGuess` treats the wall-clock string as if it were already UTC,
 * then two rounds of {@link offsetMs} correct it to the zone's actual
 * offset — one round handles the ordinary case, the second catches a
 * guess that landed on the wrong side of a DST transition.
 */
export function fromZonedInputValue(value: string, timeZone: string): string {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);

  const offset1 = offsetMs(utcGuess, timeZone);
  const offset2 = offsetMs(utcGuess - offset1, timeZone);
  const utc = utcGuess - offset2;

  return new Date(utc).toISOString();
}
