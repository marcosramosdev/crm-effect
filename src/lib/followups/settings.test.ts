import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOWUP_OFFSETS,
  DEFAULT_FOLLOWUP_TEMPLATE,
  DEFAULT_STALE_LEAD_DAYS,
  readFollowupSettings,
  validateFollowupSettings,
} from "./settings";

describe("readFollowupSettings", () => {
  it("reports the D4 defaults when the account has never configured follow-ups", () => {
    expect(readFollowupSettings(null)).toEqual({
      offsets: [...DEFAULT_FOLLOWUP_OFFSETS],
      template: DEFAULT_FOLLOWUP_TEMPLATE,
      staleLeadDays: DEFAULT_STALE_LEAD_DAYS,
    });
    expect(readFollowupSettings(undefined)).toEqual({
      offsets: [...DEFAULT_FOLLOWUP_OFFSETS],
      template: DEFAULT_FOLLOWUP_TEMPLATE,
      staleLeadDays: DEFAULT_STALE_LEAD_DAYS,
    });
  });

  it("uses the stored values when present", () => {
    expect(
      readFollowupSettings({
        followup_offsets: [60],
        followup_reminder_template: "Oi {nome}",
        stale_lead_days: 30,
      }),
    ).toEqual({ offsets: [60], template: "Oi {nome}", staleLeadDays: 30 });
  });
});

describe("validateFollowupSettings", () => {
  const base = () => ({
    offsets: [...DEFAULT_FOLLOWUP_OFFSETS],
    template: DEFAULT_FOLLOWUP_TEMPLATE,
    staleLeadDays: DEFAULT_STALE_LEAD_DAYS,
  });

  it("accepts the defaults", () => {
    expect(validateFollowupSettings(base())).toEqual({ ok: true });
  });

  it("accepts zero offsets (disables reminder preparation)", () => {
    expect(validateFollowupSettings({ ...base(), offsets: [] })).toEqual({
      ok: true,
    });
  });

  it("rejects a fourth offset", () => {
    expect(
      validateFollowupSettings({ ...base(), offsets: [60, 120, 180, 240] }),
    ).toEqual({ ok: false, reason: "too_many_offsets" });
  });

  it("rejects a duplicate offset", () => {
    expect(
      validateFollowupSettings({ ...base(), offsets: [120, 120] }),
    ).toEqual({ ok: false, reason: "duplicate_offset" });
  });

  it("rejects a non-positive offset", () => {
    expect(validateFollowupSettings({ ...base(), offsets: [0] })).toEqual({
      ok: false,
      reason: "non_positive_offset",
    });
    expect(validateFollowupSettings({ ...base(), offsets: [-10] })).toEqual({
      ok: false,
      reason: "non_positive_offset",
    });
  });

  it("rejects a non-positive stale-lead threshold", () => {
    expect(
      validateFollowupSettings({ ...base(), staleLeadDays: 0 }),
    ).toEqual({ ok: false, reason: "non_positive_threshold" });
    expect(
      validateFollowupSettings({ ...base(), staleLeadDays: -1 }),
    ).toEqual({ ok: false, reason: "non_positive_threshold" });
  });

  it("rejects an unknown placeholder and names it", () => {
    const result = validateFollowupSettings({
      ...base(),
      template: "{convenio}",
    });
    expect(result).toEqual({
      ok: false,
      reason: "unknown_placeholder",
      unknownPlaceholders: ["convenio"],
    });
  });
});
