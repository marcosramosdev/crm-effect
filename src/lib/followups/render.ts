// ============================================================
// Follow-up body rendering — design.md D5, D6.
//
// Rendered ONCE, at preparation time, and frozen onto
// `followup_messages.body`. The reviewer approves this exact string;
// it is never re-rendered at send time (D5) — an admin editing the
// template afterwards must not silently rewrite a message a human
// already read.
// ============================================================

import { FOLLOWUP_PLACEHOLDERS, type FollowupPlaceholder } from "./template";

export interface FollowupRenderDeal {
  /** The lead's name — substituted for `{nome}`. */
  contactName: string | null;
  /** `deals.scheduled_at`, an absolute instant. */
  scheduledAt: string;
  /**
   * The deal's custom-field values, keyed by lower-cased
   * `deal_custom_fields.field_name`. `{medico}` reads the "medico"
   * entry (D6); absent or blank renders as empty text, never the
   * literal `{medico}`.
   */
  customFieldsByName?: Record<string, string | null | undefined>;
}

const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

/**
 * Render `template` for `deal`, formatting `{data}` / `{hora}` in
 * `timezone` with `Intl.DateTimeFormat` — the same instant a person
 * in that timezone would read off the calendar (change 1).
 */
export function renderFollowupBody(
  template: string,
  deal: FollowupRenderDeal,
  timezone: string,
): string {
  const scheduled = new Date(deal.scheduledAt);
  const dateText = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(scheduled);
  const timeText = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(scheduled);
  const medico = deal.customFieldsByName?.["medico"];

  const values: Record<FollowupPlaceholder, string> = {
    nome: deal.contactName?.trim() || "",
    data: dateText,
    hora: timeText,
    medico: medico?.trim() || "",
  };

  return template.replace(PLACEHOLDER_PATTERN, (whole, token: string) => {
    if ((FOLLOWUP_PLACEHOLDERS as readonly string[]).includes(token)) {
      return values[token as FollowupPlaceholder];
    }
    // Should not occur post-validation (settings.ts rejects unknown
    // placeholders at save time) — leave an unrecognised token as-is
    // rather than silently dropping it.
    return whole;
  });
}
