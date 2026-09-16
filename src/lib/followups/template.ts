// ============================================================
// Follow-up reminder template — the legal placeholder set.
//
// Single source of truth for what a reminder template may contain,
// shared by the settings form (rejects an unknown placeholder before
// save) and render.ts (which only ever substitutes these four) — see
// design.md D4.
// ============================================================

export const FOLLOWUP_PLACEHOLDERS = ["nome", "data", "hora", "medico"] as const;
export type FollowupPlaceholder = (typeof FOLLOWUP_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

/** Every `{token}` in `template` that is not a legal placeholder. */
export function unknownPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const token = match[1];
    if (!(FOLLOWUP_PLACEHOLDERS as readonly string[]).includes(token)) {
      found.add(token);
    }
  }
  return [...found];
}

export type TemplatePlaceholderValidation =
  | { ok: true }
  | { ok: false; unknown: string[] };

/** Reject a template containing any placeholder outside the legal set. */
export function validateTemplatePlaceholders(
  template: string,
): TemplatePlaceholderValidation {
  const unknown = unknownPlaceholders(template);
  return unknown.length > 0 ? { ok: false, unknown } : { ok: true };
}
