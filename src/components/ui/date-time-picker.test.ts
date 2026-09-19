import { describe, expect, it } from "vitest";
import { buildValue, minuteOptions, parseValue } from "./date-time-picker";

describe("minuteOptions", () => {
  it("offers the 5-minute grid by default", () => {
    expect(minuteOptions("")).toEqual([
      "00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55",
    ]);
  });

  it("adds an off-grid minute so it stays selectable", () => {
    expect(minuteOptions("37")).toContain("37");
    expect(minuteOptions("37")).toHaveLength(13);
  });

  it("does not duplicate a minute already on the grid", () => {
    expect(minuteOptions("30")).toHaveLength(12);
  });
});

describe("parseValue / buildValue round trip", () => {
  it("round-trips an off-grid time unchanged when only the day changes", () => {
    const original = "2026-09-19T14:37";
    const { date, hour, minute } = parseValue(original);
    expect(hour).toBe("14");
    expect(minute).toBe("37");

    // Editing only the day (same hour/minute) must not touch the time.
    const nextDay = new Date(2026, 8, 20);
    expect(buildValue(nextDay, hour, minute)).toBe("2026-09-20T14:37");
    expect(date?.getDate()).toBe(19);
  });

  it("returns '' when the date is cleared", () => {
    expect(buildValue(undefined, "14", "37")).toBe("");
  });

  it("returns '' until both hour and minute are chosen", () => {
    const date = new Date(2026, 8, 19);
    expect(buildValue(date, "", "37")).toBe("");
    expect(buildValue(date, "14", "")).toBe("");
  });

  it("parses an empty value to no date and empty fields", () => {
    expect(parseValue("")).toEqual({ date: undefined, hour: "", minute: "" });
  });
});
