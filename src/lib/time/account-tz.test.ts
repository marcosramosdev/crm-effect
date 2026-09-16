import { describe, expect, it } from "vitest";
import { fromZonedInputValue, toZonedInputValue } from "./account-tz";

const TZ = "America/Sao_Paulo";

describe("toZonedInputValue / fromZonedInputValue round trip", () => {
  it("returns the same instant after a round trip through the zoned input value", () => {
    const iso = "2026-06-15T14:00:00.000Z";
    const zoned = toZonedInputValue(iso, TZ);
    expect(fromZonedInputValue(zoned, TZ)).toBe(iso);
  });

  it("returns the same wall-clock value after a round trip through the UTC instant", () => {
    // 2019-01-15 was inside Brazil's last DST window (offset -02:00).
    const local = "2019-01-15T14:00";
    const utc = fromZonedInputValue(local, TZ);
    expect(toZonedInputValue(utc, TZ)).toBe(local);
  });
});

describe("fromZonedInputValue at a DST boundary", () => {
  it("maps a DST-window wall clock to the right UTC instant (offset -02:00)", () => {
    // Brazil's last DST ran through Jan 2019; -02:00 during the window.
    expect(fromZonedInputValue("2019-01-15T14:00", TZ)).toBe(
      "2019-01-15T16:00:00.000Z",
    );
  });

  it("maps a standard-time wall clock to the right UTC instant (offset -03:00)", () => {
    // DST ended 2019-02-17; by March, standard time (-03:00) is back.
    expect(fromZonedInputValue("2019-03-15T14:00", TZ)).toBe(
      "2019-03-15T17:00:00.000Z",
    );
  });
});

describe("day boundary in the account timezone", () => {
  it("buckets a near-midnight instant into the account-timezone day, not UTC's", () => {
    // 02:30 UTC is 23:30 the previous day in America/Sao_Paulo (-03:00).
    expect(toZonedInputValue("2026-06-16T02:30:00.000Z", TZ)).toBe(
      "2026-06-15T23:30",
    );
  });

  it("buckets an instant just after local midnight into the next day", () => {
    // 03:30 UTC is 00:30 the same UTC day in America/Sao_Paulo (-03:00).
    expect(toZonedInputValue("2026-06-16T03:30:00.000Z", TZ)).toBe(
      "2026-06-16T00:30",
    );
  });
});
