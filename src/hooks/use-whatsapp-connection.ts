"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { WhatsAppConnectionState } from "@/types";

/**
 * Shared WhatsApp connection status for the whole authed shell.
 *
 * One fetch of `GET /api/whatsapp/config` (a single indexed row read —
 * no gateway round-trip), polled while the tab is visible, so the
 * sidebar logo, the mobile header dot, and the `/connection` page never
 * disagree. See design.md D1/D2 for the polling policy and the tone
 * derivation.
 */

/** Poll cadence while `document.visibilityState === 'visible'`. */
export const CONNECTION_POLL_MS = 45_000;

/** Grey = never connected, green = online, red = connection lost. */
export type ConnectionTone = "grey" | "green" | "red";

export interface ConnectionSnapshot {
  /** False until the first fetch resolves. */
  loaded: boolean;
  /** An instance has been provisioned for this account. */
  configured: boolean;
  /** Persisted gateway state (`whatsapp_config.connection_state`). */
  state: WhatsAppConnectionState;
  /** Paired WhatsApp number, once known. */
  pairedPhone: string | null;
  /** ISO timestamp of the last successful pairing. */
  pairedAt: string | null;
}

export interface ConnectionContextValue extends ConnectionSnapshot {
  tone: ConnectionTone;
  refetch: () => Promise<void>;
}

const INITIAL_SNAPSHOT: ConnectionSnapshot = {
  loaded: false,
  configured: false,
  state: "disconnected",
  pairedPhone: null,
  pairedAt: null,
};

/**
 * Map a snapshot onto the three operator-facing conditions (design D2):
 * `connected` → green; nothing ever provisioned or paired → grey;
 * anything else (including `connecting` / `hibernated`) → red.
 */
export function deriveConnectionTone(
  snapshot: Pick<ConnectionSnapshot, "configured" | "state" | "pairedPhone">,
): ConnectionTone {
  if (snapshot.state === "connected") return "green";
  if (!snapshot.configured && !snapshot.pairedPhone) return "grey";
  return "red";
}

export interface ConnectionPoller {
  /** Report a visibility change; a false→true transition polls immediately. */
  setVisible: (visible: boolean) => void;
  /** Poll now, but only if currently visible (used for window `focus`). */
  pokeIfVisible: () => void;
  /** Stop the interval; safe to call more than once. */
  stop: () => void;
}

/**
 * Visibility-gated poll scheduler, extracted so the "no fetch while
 * hidden, one fetch on becoming visible" policy is testable in the
 * node test environment (there is no jsdom here). DOM wiring lives in
 * the provider below.
 */
export function createConnectionPoller(
  onPoll: () => void,
  {
    intervalMs = CONNECTION_POLL_MS,
    initialVisible = true,
  }: { intervalMs?: number; initialVisible?: boolean } = {},
): ConnectionPoller {
  let visible = initialVisible;
  let timer: ReturnType<typeof setInterval> | null = null;

  const startTimer = () => {
    if (timer === null) timer = setInterval(onPoll, intervalMs);
  };
  const stopTimer = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  if (visible) startTimer();

  return {
    setVisible(next: boolean) {
      if (next === visible) return;
      visible = next;
      if (next) {
        onPoll();
        startTimer();
      } else {
        stopTimer();
      }
    },
    pokeIfVisible() {
      if (visible) onPoll();
    },
    stop: stopTimer,
  };
}

const ConnectionContext = createContext<ConnectionContextValue | null>(null);

export function WhatsAppConnectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] =
    useState<ConnectionSnapshot>(INITIAL_SNAPSHOT);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/config", { cache: "no-store" });
      if (!res.ok) return; // keep the last known state on a transient failure
      const data = (await res.json()) as {
        configured?: boolean;
        connection_state?: WhatsAppConnectionState;
        paired_phone?: string | null;
        paired_at?: string | null;
      };
      setSnapshot({
        loaded: true,
        configured: Boolean(data.configured),
        state: data.connection_state ?? "disconnected",
        pairedPhone: data.paired_phone ?? null,
        pairedAt: data.paired_at ?? null,
      });
    } catch {
      // Network hiccup — leave the previous snapshot in place.
    }
  }, []);

  useEffect(() => {
    // Kick off the first fetch and every poll from an async closure — the
    // setState lands after the round-trip, so this is a subscription, not
    // synchronous state juggling in the effect body.
    const poll = () => {
      void refetch();
    };
    poll();
    if (typeof document === "undefined") return;

    const poller = createConnectionPoller(poll, {
      initialVisible: document.visibilityState === "visible",
    });
    const onVisibility = () =>
      poller.setVisible(document.visibilityState === "visible");
    const onFocus = () => poller.pokeIfVisible();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      poller.stop();
    };
  }, [refetch]);

  const value = useMemo<ConnectionContextValue>(
    () => ({ ...snapshot, tone: deriveConnectionTone(snapshot), refetch }),
    [snapshot, refetch],
  );

  return createElement(ConnectionContext.Provider, { value }, children);
}

const FALLBACK: ConnectionContextValue = {
  ...INITIAL_SNAPSHOT,
  tone: "grey",
  refetch: async () => {},
};

/**
 * Read the shared connection status. Outside the provider it returns a
 * neutral "grey / not loaded" value so a stray consumer never crashes
 * (mirrors `useTheme`'s fallback).
 */
export function useWhatsAppConnection(): ConnectionContextValue {
  return useContext(ConnectionContext) ?? FALLBACK;
}
