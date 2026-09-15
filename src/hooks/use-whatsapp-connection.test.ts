import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONNECTION_POLL_MS,
  createConnectionPoller,
  deriveConnectionTone,
} from "./use-whatsapp-connection";
import type { WhatsAppConnectionState } from "@/types";

const snap = (
  state: WhatsAppConnectionState,
  configured: boolean,
  pairedPhone: string | null = null,
) => ({ state, configured, pairedPhone });

describe("deriveConnectionTone", () => {
  it("is green only when the state is connected", () => {
    expect(deriveConnectionTone(snap("connected", true, "5511999999999"))).toBe(
      "green",
    );
    // Even a bare connected state (no other signal) is green.
    expect(deriveConnectionTone(snap("connected", false))).toBe("green");
  });

  it("is grey when nothing has ever been provisioned or paired", () => {
    expect(deriveConnectionTone(snap("disconnected", false, null))).toBe(
      "grey",
    );
  });

  it("is red when an instance exists but is not connected", () => {
    expect(deriveConnectionTone(snap("disconnected", true))).toBe("red");
    expect(deriveConnectionTone(snap("connecting", true))).toBe("red");
    expect(deriveConnectionTone(snap("hibernated", true))).toBe("red");
  });

  it("is red when a number was previously paired even without a live instance", () => {
    expect(
      deriveConnectionTone(snap("disconnected", false, "5511999999999")),
    ).toBe("red");
  });
});

describe("createConnectionPoller", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not poll while hidden and polls immediately on becoming visible", () => {
    vi.useFakeTimers();
    const onPoll = vi.fn();
    const poller = createConnectionPoller(onPoll, { initialVisible: false });

    // Hidden: advancing well past several intervals fires nothing.
    vi.advanceTimersByTime(CONNECTION_POLL_MS * 3);
    expect(onPoll).not.toHaveBeenCalled();

    // Becoming visible polls right away, then on the interval.
    poller.setVisible(true);
    expect(onPoll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CONNECTION_POLL_MS);
    expect(onPoll).toHaveBeenCalledTimes(2);

    // Going hidden again stops the interval.
    poller.setVisible(false);
    vi.advanceTimersByTime(CONNECTION_POLL_MS * 5);
    expect(onPoll).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("pokeIfVisible polls only when visible", () => {
    vi.useFakeTimers();
    const onPoll = vi.fn();
    const poller = createConnectionPoller(onPoll, { initialVisible: false });

    poller.pokeIfVisible();
    expect(onPoll).not.toHaveBeenCalled();

    poller.setVisible(true);
    onPoll.mockClear();
    poller.pokeIfVisible();
    expect(onPoll).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it("starts polling on the interval when created already visible", () => {
    vi.useFakeTimers();
    const onPoll = vi.fn();
    const poller = createConnectionPoller(onPoll, { initialVisible: true });

    expect(onPoll).not.toHaveBeenCalled(); // no immediate poll, just schedules
    vi.advanceTimersByTime(CONNECTION_POLL_MS);
    expect(onPoll).toHaveBeenCalledTimes(1);

    poller.stop();
    vi.advanceTimersByTime(CONNECTION_POLL_MS * 3);
    expect(onPoll).toHaveBeenCalledTimes(1);
  });
});
