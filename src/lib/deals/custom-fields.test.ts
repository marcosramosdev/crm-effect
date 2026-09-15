import { describe, expect, it } from "vitest";

import type { DealFieldType } from "@/types";
import {
  formatDealFieldValue,
  parseDealFieldValue,
  parseIsoDate,
  validateDealFieldName,
  validateSelectOptions,
  type DealFieldDefinition,
} from "./custom-fields";

function def(
  field_type: DealFieldType,
  options?: string[],
): DealFieldDefinition {
  return {
    field_type,
    field_options: options ? { options } : null,
  };
}

describe("parseDealFieldValue", () => {
  describe("text", () => {
    it("keeps the trimmed string", () => {
      expect(parseDealFieldValue(def("text"), "  hello  ")).toEqual({
        ok: true,
        value: "hello",
      });
    });
    it("treats blank as not set", () => {
      expect(parseDealFieldValue(def("text"), "   ")).toEqual({
        ok: true,
        value: null,
      });
    });
  });

  describe("number", () => {
    it("canonicalises to a decimal string", () => {
      expect(parseDealFieldValue(def("number"), "  007.50 ")).toEqual({
        ok: true,
        value: "7.5",
      });
      expect(parseDealFieldValue(def("number"), "-3")).toEqual({
        ok: true,
        value: "-3",
      });
    });
    it("rejects a non-numeric value", () => {
      expect(parseDealFieldValue(def("number"), "12abc")).toEqual({
        ok: false,
        reason: "not_a_number",
      });
      expect(parseDealFieldValue(def("number"), "NaN")).toEqual({
        ok: false,
        reason: "not_a_number",
      });
    });
    it("treats blank as not set", () => {
      expect(parseDealFieldValue(def("number"), "")).toEqual({
        ok: true,
        value: null,
      });
    });
  });

  describe("date", () => {
    it("accepts a valid ISO date", () => {
      expect(parseDealFieldValue(def("date"), "2026-02-28")).toEqual({
        ok: true,
        value: "2026-02-28",
      });
    });
    it("rejects a malformed date", () => {
      expect(parseDealFieldValue(def("date"), "2026-2-1")).toEqual({
        ok: false,
        reason: "not_a_date",
      });
      expect(parseDealFieldValue(def("date"), "02/01/2026")).toEqual({
        ok: false,
        reason: "not_a_date",
      });
    });
    it("rejects an impossible calendar date", () => {
      expect(parseDealFieldValue(def("date"), "2026-02-30")).toEqual({
        ok: false,
        reason: "not_a_date",
      });
      expect(parseDealFieldValue(def("date"), "2026-13-01")).toEqual({
        ok: false,
        reason: "not_a_date",
      });
    });
    it("treats blank as not set", () => {
      expect(parseDealFieldValue(def("date"), null)).toEqual({
        ok: true,
        value: null,
      });
    });
  });

  describe("select", () => {
    const d = def("select", ["Low", "High"]);
    it("accepts a current option", () => {
      expect(parseDealFieldValue(d, "High")).toEqual({
        ok: true,
        value: "High",
      });
    });
    it("rejects a value not among the current options", () => {
      expect(parseDealFieldValue(d, "Medium")).toEqual({
        ok: false,
        reason: "not_an_option",
      });
    });
    it("treats blank as not set", () => {
      expect(parseDealFieldValue(d, "")).toEqual({ ok: true, value: null });
    });
  });

  describe("checkbox", () => {
    const d = def("checkbox");
    it('coerces truthy inputs to "true"', () => {
      expect(parseDealFieldValue(d, true)).toEqual({ ok: true, value: "true" });
      expect(parseDealFieldValue(d, "yes")).toEqual({
        ok: true,
        value: "true",
      });
      expect(parseDealFieldValue(d, "1")).toEqual({ ok: true, value: "true" });
    });
    it('coerces falsy inputs to "false"', () => {
      expect(parseDealFieldValue(d, false)).toEqual({
        ok: true,
        value: "false",
      });
      expect(parseDealFieldValue(d, "no")).toEqual({
        ok: true,
        value: "false",
      });
    });
    it("treats null/empty as not set (not a false default)", () => {
      expect(parseDealFieldValue(d, null)).toEqual({ ok: true, value: null });
      expect(parseDealFieldValue(d, "")).toEqual({ ok: true, value: null });
    });
  });

  it("reports an unknown type", () => {
    expect(
      parseDealFieldValue(
        { field_type: "bogus" as DealFieldType, field_options: null },
        "x",
      ),
    ).toEqual({ ok: false, reason: "unknown_type" });
  });
});

describe("parseIsoDate", () => {
  it("normalises and validates", () => {
    expect(parseIsoDate(" 2024-02-29 ")).toBe("2024-02-29"); // leap year
    expect(parseIsoDate("2023-02-29")).toBeNull(); // not a leap year
    expect(parseIsoDate("1999-12-31")).toBe("1999-12-31");
  });
});

describe("formatDealFieldValue", () => {
  it("renders checkbox as Yes/No", () => {
    expect(formatDealFieldValue(def("checkbox"), "true")).toBe("Yes");
    expect(formatDealFieldValue(def("checkbox"), "false")).toBe("No");
  });
  it('renders "not set" as an empty string', () => {
    expect(formatDealFieldValue(def("text"), null)).toBe("");
    expect(formatDealFieldValue(def("number"), "")).toBe("");
  });
  it("passes text / number / date / select through verbatim", () => {
    expect(formatDealFieldValue(def("text"), "abc")).toBe("abc");
    expect(formatDealFieldValue(def("date"), "2026-01-01")).toBe("2026-01-01");
  });
});

describe("validateDealFieldName", () => {
  it("rejects a blank name", () => {
    expect(validateDealFieldName("   ", [])).toEqual({
      ok: false,
      reason: "blank",
    });
  });
  it("rejects a case-insensitive duplicate", () => {
    expect(validateDealFieldName("Contract", ["contract", "Renewal"])).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });
  it("accepts and trims a unique name", () => {
    expect(validateDealFieldName("  Renewal date  ", ["Contract"])).toEqual({
      ok: true,
      name: "Renewal date",
    });
  });
  it("a rename to the same name is fine when it is not in the other list", () => {
    expect(validateDealFieldName("Contract", ["Renewal"])).toEqual({
      ok: true,
      name: "Contract",
    });
  });
});

describe("validateSelectOptions", () => {
  it("rejects a list that is empty after cleaning", () => {
    expect(validateSelectOptions(["", "   "])).toEqual({
      ok: false,
      reason: "empty",
    });
    expect(validateSelectOptions([])).toEqual({ ok: false, reason: "empty" });
  });
  it("trims, drops blanks, and de-duplicates case-insensitively", () => {
    expect(validateSelectOptions(["  A ", "b", "", "a", "B", "c"])).toEqual({
      ok: true,
      options: ["A", "b", "c"],
    });
  });
  it("keeps a single valid option", () => {
    expect(validateSelectOptions(["Only"])).toEqual({
      ok: true,
      options: ["Only"],
    });
  });
});
