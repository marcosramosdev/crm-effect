import { describe, expect, it } from "vitest";
import {
  buildFollowupButtonId,
  followupReminderButtons,
  parseFollowupButtonId,
} from "./buttons";

describe("buildFollowupButtonId / parseFollowupButtonId", () => {
  it("round-trips a well-formed id", () => {
    const id = buildFollowupButtonId("fu-123", "confirm");
    expect(parseFollowupButtonId(id)).toEqual({
      followupId: "fu-123",
      action: "confirm",
    });
    const id2 = buildFollowupButtonId("fu-123", "reschedule");
    expect(parseFollowupButtonId(id2)).toEqual({
      followupId: "fu-123",
      action: "reschedule",
    });
  });

  it("returns null for an unrelated reply id", () => {
    expect(parseFollowupButtonId("flow:step-1:next")).toBeNull();
    expect(parseFollowupButtonId("automation-btn-1")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(parseFollowupButtonId("")).toBeNull();
    expect(parseFollowupButtonId(null)).toBeNull();
    expect(parseFollowupButtonId(undefined)).toBeNull();
  });

  it("returns null for a malformed fu: id", () => {
    expect(parseFollowupButtonId("fu:")).toBeNull();
    expect(parseFollowupButtonId("fu:only-id")).toBeNull();
    expect(parseFollowupButtonId("fu:id:unknown-action")).toBeNull();
  });
});

describe("followupReminderButtons", () => {
  it("carries exactly a confirm and a reschedule button", () => {
    const buttons = followupReminderButtons("fu-123");
    expect(buttons).toEqual([
      { id: "fu:fu-123:confirm", title: "Confirmar" },
      { id: "fu:fu-123:reschedule", title: "Remarcar" },
    ]);
  });
});
