import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatNumber, formatTime } from "./format";

const INSTANT = "2026-09-19T12:00:00Z";

describe("formatDate", () => {
  it("renders Brazilian day/month/year order under the default locale", () => {
    expect(formatDate(INSTANT)).toBe("19/09/2026");
  });

  it("renders month/day/year order for an explicit English locale", () => {
    expect(formatDate(INSTANT, "en")).toBe("9/19/2026");
  });
});

describe("formatNumber", () => {
  it("uses '.' for grouping and ',' for decimals under the default locale", () => {
    expect(formatNumber(1234.5, undefined, { minimumFractionDigits: 2 })).toBe(
      "1.234,50",
    );
  });

  it("uses ',' for grouping and '.' for decimals under an explicit English locale", () => {
    expect(formatNumber(1234.5, "en", { minimumFractionDigits: 2 })).toBe(
      "1,234.50",
    );
  });
});

describe("formatTime and formatDateTime", () => {
  it("formatTime defaults to the app locale", () => {
    expect(formatTime(INSTANT)).not.toMatch(/AM|PM/);
  });

  it("formatDateTime combines date and time in the app locale", () => {
    expect(formatDateTime(INSTANT)).toMatch(/^19\/09\/2026/);
  });
});
