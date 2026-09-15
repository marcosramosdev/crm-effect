// ============================================================
// Per-recipient {{field}} variable resolution for broadcasts.
//
// Replaces Meta template `{{1}}`/`{{2}}` positional substitution
// (design.md D5): a broadcast body now names its own placeholders
// (`{{name}}`, `{{company}}`, `{{deal_size}}`, …), resolved per
// recipient against built-in contact fields first, then the
// account's custom fields by `field_name` (case-insensitive).
//
// Split into three small pure functions rather than one "resolve and
// substitute" call so each stage can be frozen/replayed independently:
//   - extractVariableNames  — what placeholders does this body use?
//   - resolveVariableValues — look each one up for ONE recipient, or
//     report the first one with neither a value nor a fallback.
//   - substituteVariables   — pure string substitution from an
//     already-resolved map.
//
// This split matters because the resolved map (not the final text) is
// what gets frozen onto `broadcast_recipients.template_params`
// (broadcasts spec, "Per-recipient variable substitution" +
// design.md's migration-038 note): a resume must replay the exact
// values the original pass resolved, not re-derive them against
// contact data that may have changed since — same reason the old
// Meta-template `template_params` array was frozen at plan time.
// ============================================================

/** Matches `{{ any text }}`, trimming inner whitespace from the name. */
const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/** Built-in `contacts` columns a placeholder can name directly. */
const BUILTIN_CONTACT_FIELDS = ["name", "phone", "email", "company"] as const;

/** Extract the set of unique placeholder names used in a message body. */
export function extractVariableNames(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(VARIABLE_PATTERN)) {
    names.add(match[1].trim());
  }
  return [...names];
}

export interface VariableRecipientData {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  /** Custom-field values for this contact, keyed by `field_name` (lowercased). */
  customValues?: Map<string, string>;
}

export interface ResolveVariablesResult {
  /** Placeholder name → resolved value (contact field, custom field, or fallback). */
  values: Record<string, string>;
  /**
   * First placeholder that had no value on the recipient AND no
   * user-supplied fallback — broadcasts spec, "Missing value with no
   * fallback". Undefined when every placeholder resolved.
   */
  unresolvedVariable?: string;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function lookupContactValue(
  name: string,
  recipient: VariableRecipientData,
): string | undefined {
  const lower = name.toLowerCase();
  if ((BUILTIN_CONTACT_FIELDS as readonly string[]).includes(lower)) {
    return nonEmpty(
      recipient[lower as (typeof BUILTIN_CONTACT_FIELDS)[number]],
    );
  }
  return nonEmpty(recipient.customValues?.get(lower));
}

/**
 * Resolve every placeholder in `names` for one recipient. Stops
 * recording new values once it hits the first unresolved one (nothing
 * downstream reads values past that point — the recipient is marked
 * failed), but still returns whatever resolved before it so a caller
 * that only wants a preview can render as far as it got.
 */
export function resolveVariableValues(
  names: string[],
  recipient: VariableRecipientData,
  defaults?: Record<string, string> | null,
): ResolveVariablesResult {
  const values: Record<string, string> = {};

  for (const name of names) {
    const value = lookupContactValue(name, recipient);
    if (value !== undefined) {
      values[name] = value;
      continue;
    }

    const fallback = defaults?.[name];
    if (fallback !== undefined) {
      values[name] = fallback;
      continue;
    }

    return { values, unresolvedVariable: name };
  }

  return { values };
}

/** Substitute an already-resolved `{name: value}` map into a body. Unresolved
 *  placeholders (not present in `values`) are left as-is. */
export function substituteVariables(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(VARIABLE_PATTERN, (full, rawName: string) => {
    const name = rawName.trim();
    return Object.prototype.hasOwnProperty.call(values, name)
      ? values[name]
      : full;
  });
}
