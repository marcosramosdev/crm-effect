import { describe, expect, it } from "vitest";
import { classifyAccountMetaStatus, type AccountMetaRow } from "./meta-accounts-panel";

function row(overrides: Partial<AccountMetaRow> = {}): AccountMetaRow {
  return {
    id: "acct-1",
    name: "Test Clinic",
    metaDatasetId: null,
    hasAccessToken: false,
    metaPageId: null,
    metaEventName: "Lead",
    metaTestEventCode: null,
    metaSendPh: false,
    pendingCount: 0,
    unconfiguredCount: 0,
    ...overrides,
  };
}

describe("classifyAccountMetaStatus", () => {
  it("neither dataset nor token: not configured, not partial", () => {
    const s = classifyAccountMetaStatus(row());
    expect(s.isConfigured).toBe(false);
    expect(s.isPartial).toBe(false);
  });

  it("both dataset and token: configured, not partial", () => {
    const s = classifyAccountMetaStatus(
      row({ metaDatasetId: "ds-1", hasAccessToken: true }),
    );
    expect(s.isConfigured).toBe(true);
    expect(s.isPartial).toBe(false);
  });

  it("dataset without token: not configured, partial (broken state)", () => {
    const s = classifyAccountMetaStatus(row({ metaDatasetId: "ds-1" }));
    expect(s.isConfigured).toBe(false);
    expect(s.isPartial).toBe(true);
  });

  it("token without dataset: not configured, partial", () => {
    const s = classifyAccountMetaStatus(row({ hasAccessToken: true }));
    expect(s.isConfigured).toBe(false);
    expect(s.isPartial).toBe(true);
  });

  it("test event code set: test mode (tasks.md 6.2)", () => {
    expect(classifyAccountMetaStatus(row({ metaTestEventCode: "TEST1" })).isTestMode).toBe(
      true,
    );
    expect(classifyAccountMetaStatus(row()).isTestMode).toBe(false);
  });

  it("zero pending and zero unconfigured reads as no conversions yet, not an error (tasks.md 6.3)", () => {
    expect(classifyAccountMetaStatus(row()).hasNoConversions).toBe(true);
    expect(
      classifyAccountMetaStatus(row({ pendingCount: 1 })).hasNoConversions,
    ).toBe(false);
    expect(
      classifyAccountMetaStatus(row({ unconfiguredCount: 1 })).hasNoConversions,
    ).toBe(false);
  });
});
