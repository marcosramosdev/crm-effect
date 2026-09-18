import { describe, expect, it } from "vitest";

import {
  classifyAccountMetaStatus,
  deriveAccountSetup,
  totalConversions,
  visibleConversionCounts,
  type AccountMetaRow,
} from "./account-status";

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
    connectionState: null,
    pairedPhone: null,
    pairedAt: null,
    counts: {},
    deactivatedAt: null,
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

  it("test event code set: test mode", () => {
    expect(classifyAccountMetaStatus(row({ metaTestEventCode: "TEST1" })).isTestMode).toBe(
      true,
    );
    expect(classifyAccountMetaStatus(row()).isTestMode).toBe(false);
  });

  it("zero conversions in every state reads as no conversions yet, not an error", () => {
    expect(classifyAccountMetaStatus(row()).hasNoConversions).toBe(true);
    expect(
      classifyAccountMetaStatus(row({ counts: { pending: 1 } })).hasNoConversions,
    ).toBe(false);
    expect(
      classifyAccountMetaStatus(row({ counts: { unconfigured: 1 } })).hasNoConversions,
    ).toBe(false);
    // A state that only the conversion sender writes still counts.
    expect(
      classifyAccountMetaStatus(row({ counts: { failed: 1 } })).hasNoConversions,
    ).toBe(false);
  });

  it("connection comes from the stored state, and a missing config row is not connected", () => {
    expect(classifyAccountMetaStatus(row({ connectionState: "connected" })).isConnected).toBe(
      true,
    );
    expect(
      classifyAccountMetaStatus(row({ connectionState: "disconnected" })).isConnected,
    ).toBe(false);
    expect(classifyAccountMetaStatus(row()).isConnected).toBe(false);
  });
});

describe("visibleConversionCounts", () => {
  it("always shows waiting and unreportable, even at zero", () => {
    expect(visibleConversionCounts({})).toEqual([
      { status: "pending", count: 0 },
      { status: "unconfigured", count: 0 },
    ]);
  });

  it("shows a delivery state as soon as it holds something", () => {
    const shown = visibleConversionCounts({ failed: 2, canceled: 1 });
    expect(shown).toContainEqual({ status: "failed", count: 2 });
    expect(shown).toContainEqual({ status: "canceled", count: 1 });
    expect(shown.some((c) => c.status === "sent")).toBe(false);
  });
});

describe("totalConversions", () => {
  it("sums every state", () => {
    expect(totalConversions({ pending: 2, canceled: 3, failed: 1 })).toBe(6);
    expect(totalConversions({})).toBe(0);
  });
});

describe("deriveAccountSetup", () => {
  const facts = (account: AccountMetaRow, hasAdOriginatedContact = false) =>
    deriveAccountSetup({ account, hasAdOriginatedContact });

  it("reports the connection", () => {
    expect(facts(row({ connectionState: "connected" })).whatsappConnected).toBe(true);
    expect(facts(row({ connectionState: "connecting" })).whatsappConnected).toBe(false);
  });

  it("reports the credentials only when both are present", () => {
    expect(facts(row({ metaDatasetId: "ds-1" })).credentialsPresent).toBe(false);
    expect(
      facts(row({ metaDatasetId: "ds-1", hasAccessToken: true })).credentialsPresent,
    ).toBe(true);
  });

  it("treats a set test event code as a condition NOT yet met", () => {
    expect(facts(row()).testModeCleared).toBe(true);
    expect(facts(row({ metaTestEventCode: "TEST1" })).testModeCleared).toBe(false);
  });

  it("reports whether an ad-originated contact has arrived", () => {
    expect(facts(row(), true).adContactArrived).toBe(true);
    expect(facts(row(), false).adContactArrived).toBe(false);
  });

  it("reports whether any conversion has been recorded", () => {
    expect(facts(row({ counts: { unconfigured: 1 } })).conversionRecorded).toBe(true);
    expect(facts(row()).conversionRecorded).toBe(false);
  });
});
