// ============================================================
// Follow-up reminder buttons — design.md D8.
//
// The button id carries the follow-up id, so routing on the webhook
// needs no lookup table and reads the id, never the label — which is
// what makes "typed text is not a button press" true by construction
// (typed text arrives with `interactive_reply_id = NULL`, see the
// inbox spec delta).
// ============================================================

import type { InteractiveButton } from "@/lib/whatsapp/interactive";

export type FollowupButtonAction = "confirm" | "reschedule";

const PREFIX = "fu";

export function buildFollowupButtonId(
  followupId: string,
  action: FollowupButtonAction,
): string {
  return `${PREFIX}:${followupId}:${action}`;
}

export interface ParsedFollowupButtonId {
  followupId: string;
  action: FollowupButtonAction;
}

/**
 * Parse a webhook `interactive_reply_id` into `{ followupId, action }`,
 * or null when it doesn't carry this shape — an unrelated flow/
 * automation button id, empty input, or a malformed `fu:` id all
 * parse to null so the caller can safely ignore anything not meant
 * for this capability.
 */
export function parseFollowupButtonId(
  raw: string | null | undefined,
): ParsedFollowupButtonId | null {
  if (!raw) return null;
  const match = /^fu:(.+):(confirm|reschedule)$/.exec(raw);
  if (!match) return null;
  return { followupId: match[1], action: match[2] as FollowupButtonAction };
}

/** The two-button interactive payload a released reminder carries (D8). */
export function followupReminderButtons(followupId: string): InteractiveButton[] {
  return [
    { id: buildFollowupButtonId(followupId, "confirm"), title: "Confirmar" },
    { id: buildFollowupButtonId(followupId, "reschedule"), title: "Remarcar" },
  ];
}
