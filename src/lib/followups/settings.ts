// ============================================================
// Per-account follow-up configuration — defaults + validation.
//
// design.md D4: three scalars live directly on `accounts`
// (`followup_offsets`, `followup_reminder_template`,
// `stale_lead_days`), admin-editable, readable by any member. This
// module is the one place the settings form and any server reader
// agree on the D4 defaults and the "rejected as a whole" validation
// rule (specs/followups/spec.md, "An account configures how its
// reminders are prepared").
// ============================================================

import { validateTemplatePlaceholders } from "./template";

/** Minutes before the appointment: 5 days, 1 day, 2 hours. */
export const DEFAULT_FOLLOWUP_OFFSETS: readonly number[] = [7200, 1440, 120];

export const DEFAULT_FOLLOWUP_TEMPLATE =
  "Olá {nome}! Passando para lembrar do seu horário em {data} às {hora} com {medico}. Você confirma?";

export const DEFAULT_STALE_LEAD_DAYS = 15;

export const MAX_FOLLOWUP_OFFSETS = 3;

export interface FollowupSettings {
  /** Minutes before `deals.scheduled_at`. At most 3, each positive, no duplicates. */
  offsets: number[];
  template: string;
  /** Days of silence after which a lead counts as stale. */
  staleLeadDays: number;
}

interface FollowupSettingsRow {
  followup_offsets?: number[] | null;
  followup_reminder_template?: string | null;
  stale_lead_days?: number | null;
}

/** Apply the D4 defaults to an accounts row that hasn't set them yet. */
export function readFollowupSettings(
  row: FollowupSettingsRow | null | undefined,
): FollowupSettings {
  return {
    offsets: row?.followup_offsets ?? [...DEFAULT_FOLLOWUP_OFFSETS],
    template: row?.followup_reminder_template ?? DEFAULT_FOLLOWUP_TEMPLATE,
    staleLeadDays: row?.stale_lead_days ?? DEFAULT_STALE_LEAD_DAYS,
  };
}

export type FollowupSettingsInvalidReason =
  | "too_many_offsets"
  | "non_positive_offset"
  | "duplicate_offset"
  | "non_positive_threshold"
  | "unknown_placeholder";

export type FollowupSettingsValidation =
  | { ok: true }
  | {
      ok: false;
      reason: FollowupSettingsInvalidReason;
      /** Set only for `unknown_placeholder` — the offending token(s). */
      unknownPlaceholders?: string[];
    };

/**
 * Validate a proposed configuration as a whole. A submission failing
 * ANY rule is rejected entirely — the caller must leave the stored
 * configuration untouched (spec: "rejected as a whole"). Zero offsets
 * is legal (disables reminder preparation for the account).
 */
export function validateFollowupSettings(
  input: FollowupSettings,
): FollowupSettingsValidation {
  if (input.offsets.length > MAX_FOLLOWUP_OFFSETS) {
    return { ok: false, reason: "too_many_offsets" };
  }
  if (input.offsets.some((o) => !Number.isFinite(o) || o <= 0)) {
    return { ok: false, reason: "non_positive_offset" };
  }
  if (new Set(input.offsets).size !== input.offsets.length) {
    return { ok: false, reason: "duplicate_offset" };
  }
  if (!Number.isFinite(input.staleLeadDays) || input.staleLeadDays <= 0) {
    return { ok: false, reason: "non_positive_threshold" };
  }
  const placeholders = validateTemplatePlaceholders(input.template);
  if (!placeholders.ok) {
    return {
      ok: false,
      reason: "unknown_placeholder",
      unknownPlaceholders: placeholders.unknown,
    };
  }
  return { ok: true };
}
