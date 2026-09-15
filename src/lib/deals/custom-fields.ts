// ============================================================
// Deal custom field value parsing / validation.
//
// The single enforcement point for deal custom field values
// (design.md D2). The DB stores every value as TEXT and the
// definition's `field_type` decides how it is interpreted; this
// module is where that interpretation lives so the deal detail
// view and any future API path agree.
//
// Canonical stored encodings:
//   text     -> the trimmed string
//   number   -> a decimal string (`String(Number(raw))`)
//   date     -> `YYYY-MM-DD`
//   select   -> one of the definition's current options, verbatim
//   checkbox -> the literal 'true' or 'false'
//
// An empty / blank / null input resolves to `value: null` on
// every type — "not set", meaning the caller stores no row (and
// an absent row reads back the same way). The system never
// invents a default.
// ============================================================

import type { DealCustomField, DealFieldType } from "@/types";

/** The subset of a definition this module needs. */
export type DealFieldDefinition = Pick<
  DealCustomField,
  "field_type" | "field_options"
>;

export type DealFieldParseReason =
  "not_a_number" | "not_a_date" | "not_an_option" | "unknown_type";

export type DealFieldParseResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: DealFieldParseReason };

/** A blank scalar input — treated as "not set" regardless of type. */
function isBlank(raw: unknown): boolean {
  return (
    raw === null ||
    raw === undefined ||
    (typeof raw === "string" && raw.trim() === "")
  );
}

/**
 * Strict `YYYY-MM-DD` calendar-date check. Rejects the wrong
 * shape (`2026-1-1`, `01/02/2026`) and impossible dates
 * (`2026-02-30`, `2026-13-01`). Returns the normalised string or
 * null.
 */
export function parseIsoDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Round-trip through a UTC date to reject e.g. Feb 30.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Options for a `select` definition, or `[]` if malformed / absent. */
export function selectOptions(def: DealFieldDefinition): string[] {
  const opts = def.field_options?.options;
  return Array.isArray(opts) ? opts.filter((o) => typeof o === "string") : [];
}

/**
 * Coerce `raw` to the canonical stored form for `def.field_type`,
 * or report why it does not conform. A blank input is always
 * `{ ok: true, value: null }`.
 */
export function parseDealFieldValue(
  def: DealFieldDefinition,
  raw: string | boolean | null | undefined,
): DealFieldParseResult {
  // checkbox is the one type where a boolean is a natural input and
  // "false" is a real value rather than "not set".
  if (def.field_type === "checkbox") {
    if (raw === null || raw === undefined || raw === "") {
      return { ok: true, value: null };
    }
    if (typeof raw === "boolean") {
      return { ok: true, value: raw ? "true" : "false" };
    }
    const s = String(raw).trim().toLowerCase();
    if (["true", "1", "yes", "on", "checked"].includes(s)) {
      return { ok: true, value: "true" };
    }
    if (["false", "0", "no", "off", "unchecked"].includes(s)) {
      return { ok: true, value: "false" };
    }
    return { ok: true, value: null };
  }

  if (isBlank(raw)) return { ok: true, value: null };
  const str = String(raw).trim();

  switch (def.field_type) {
    case "text":
      return { ok: true, value: str };

    case "number": {
      const n = Number(str);
      if (!Number.isFinite(n)) return { ok: false, reason: "not_a_number" };
      return { ok: true, value: String(n) };
    }

    case "date": {
      const iso = parseIsoDate(str);
      if (iso === null) return { ok: false, reason: "not_a_date" };
      return { ok: true, value: iso };
    }

    case "select": {
      if (!selectOptions(def).includes(str)) {
        return { ok: false, reason: "not_an_option" };
      }
      return { ok: true, value: str };
    }

    default:
      return { ok: false, reason: "unknown_type" };
  }
}

/**
 * Human-readable rendering of a stored value for display. Returns
 * an empty string for "not set". Locale formatting of dates /
 * numbers is left to the caller; this only decodes the canonical
 * form (notably `checkbox` -> Yes/No).
 */
export function formatDealFieldValue(
  def: DealFieldDefinition,
  value: string | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (def.field_type === "checkbox") {
    return value === "true" ? "Yes" : "No";
  }
  return value;
}

// ============================================================
// Definition-level validation (used by the Settings catalogue).
// ============================================================

export type DealFieldNameReason = "blank" | "duplicate";

export type DealFieldNameResult =
  { ok: true; name: string } | { ok: false; reason: DealFieldNameReason };

/**
 * Validate a proposed field name against the account's catalogue.
 * `otherNames` is every *other* definition's name (the caller
 * excludes the one being renamed). Comparison is
 * case-insensitive, matching the DB's
 * `idx_deal_custom_fields_account_name` unique index.
 */
export function validateDealFieldName(
  name: string,
  otherNames: string[],
): DealFieldNameResult {
  const trimmed = name.trim();
  if (trimmed === "") return { ok: false, reason: "blank" };
  const lower = trimmed.toLowerCase();
  if (otherNames.some((n) => n.trim().toLowerCase() === lower)) {
    return { ok: false, reason: "duplicate" };
  }
  return { ok: true, name: trimmed };
}

export type SelectOptionsResult =
  { ok: true; options: string[] } | { ok: false; reason: "empty" };

/**
 * Clean and validate the option list for a `select` definition:
 * trim each entry, drop blanks, and de-duplicate case-insensitively
 * (keeping the first spelling). At least one option must survive —
 * mirrors the DB CHECK `deal_custom_fields_select_has_options`.
 */
export function validateSelectOptions(raw: string[]): SelectOptionsResult {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const entry of raw) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(trimmed);
  }
  if (options.length === 0) return { ok: false, reason: "empty" };
  return { ok: true, options };
}

/** Whether a definition needs its `field_options.options` populated. */
export function fieldTypeNeedsOptions(type: DealFieldType): boolean {
  return type === "select";
}
