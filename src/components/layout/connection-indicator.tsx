"use client";

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import {
  useWhatsAppConnection,
  type ConnectionTone,
} from "@/hooks/use-whatsapp-connection";

/**
 * Presentational reads of the shared WhatsApp connection status
 * (`useWhatsAppConnection`). Colour is never the only cue — every
 * surface carries an `aria-label` / `title` with the status in words.
 * See design.md D3.
 */

/** Icon + label tint for the "WhatsApp" bottom-nav row in the sidebar. */
const NAV_TONE: Record<ConnectionTone, string> = {
  grey: "text-muted-foreground",
  green: "text-emerald-500",
  red: "text-red-500",
};

/** Small status-dot colour for the mobile header. */
const DOT_TONE: Record<ConnectionTone, string> = {
  grey: "bg-muted-foreground",
  green: "bg-emerald-500",
  red: "bg-red-500",
};

/** Current tone plus a localized "WhatsApp connection: <status>" label. */
export function useConnectionStatus(): {
  tone: ConnectionTone;
  label: string;
  navClass: string;
  dotClass: string;
} {
  const { tone } = useWhatsAppConnection();
  const t = useTranslations("Connection");
  const status =
    tone === "green"
      ? t("statusOnline")
      : tone === "red"
        ? t("statusLost")
        : t("statusNever");
  return {
    tone,
    label: t("indicatorLabel", { status }),
    navClass: NAV_TONE[tone],
    dotClass: DOT_TONE[tone],
  };
}

/**
 * A small live status dot. Used in the mobile header where the sidebar
 * "WhatsApp" nav row (which carries the same status on desktop) is
 * off-canvas.
 */
export function ConnectionDot({ className }: { className?: string }) {
  const { label, dotClass } = useConnectionStatus();
  return (
    <span
      role="status"
      aria-label={label}
      title={label}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        dotClass,
        className,
      )}
    />
  );
}
