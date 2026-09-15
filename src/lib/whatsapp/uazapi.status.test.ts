import { describe, expect, it } from "vitest";
import {
  type MessageDeliveryStatus,
  mapUazapiMessageStatus,
  nextMessageStatus,
} from "./uazapi";

describe("mapUazapiMessageStatus", () => {
  it.each([
    ["Queued", "pending"],
    ["Sent", "sent"],
    ["Delivered", "delivered"],
    ["Read", "read"],
    ["Failed", "failed"],
    ["Canceled", "failed"],
  ] as const)("maps %s to %s", (raw, expected) => {
    expect(mapUazapiMessageStatus(raw)).toBe(expected);
  });

  it("returns null for an unrecognised status", () => {
    expect(mapUazapiMessageStatus("Something Else")).toBeNull();
  });
});

describe("nextMessageStatus", () => {
  // [current, rawIncoming, expected]
  const cases: Array<
    [
      MessageDeliveryStatus | null | undefined,
      string,
      MessageDeliveryStatus | null,
    ]
  > = [
    // No current status yet — accept whatever arrives first.
    [null, "Queued", "pending"],
    [undefined, "Sent", "sent"],

    // Forward progression along the ladder.
    ["pending", "Sent", "sent"],
    ["sent", "Delivered", "delivered"],
    ["delivered", "Read", "read"],
    ["pending", "Read", "read"], // skips straight to read — still forward

    // Out-of-order / regression — ignored.
    ["delivered", "Sent", null],
    ["read", "Delivered", null],
    ["sent", "Queued", null],

    // Same-status replay — not a forward move, ignored.
    ["sent", "Sent", null],
    ["read", "Read", null],

    // Failed always wins over a non-failed current status.
    ["pending", "Failed", "failed"],
    ["sent", "Failed", "failed"],
    ["delivered", "Failed", "failed"],
    ["read", "Canceled", "failed"],
    [null, "Failed", "failed"],

    // Failed is terminal — nothing changes it further, including another "Failed".
    ["failed", "Sent", null],
    ["failed", "Delivered", null],
    ["failed", "Read", null],
    ["failed", "Failed", null],

    // Unrecognised raw status — ignored regardless of current.
    ["sent", "Bogus", null],
    [null, "Bogus", null],
  ];

  it.each(cases)(
    "current=%s incoming=%s -> %s",
    (current, rawIncoming, expected) => {
      expect(nextMessageStatus(current, rawIncoming)).toBe(expected);
    },
  );
});
