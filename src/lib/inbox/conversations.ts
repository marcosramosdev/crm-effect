import type { Conversation, Contact, Deal, Tag } from "@/types";

/**
 * Conversation select that embeds the contact plus its tags and open deals,
 * so the Inbox can filter by contact tag and show an inline pipeline-stage
 * control on each row without a second round-trip. `contact_tags(tags(*))`
 * returns the tag join rows; `deals(...)` returns the contact's deals with
 * their current stage. {@link normalizeConversation} flattens the tags onto
 * `contact.tags` and derives `contact.primaryDeal`.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*)), deals(id, pipeline_id, stage_id, status, created_at, stage:pipeline_stages(id, name, color, position)))";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawDeal = Pick<
  Deal,
  "id" | "pipeline_id" | "stage_id" | "status" | "created_at"
> & { stage?: Deal["stage"] | null };
type RawContact = Contact & {
  contact_tags?: { tags: Tag | null }[];
  deals?: RawDeal[] | null;
};
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/** The contact's most recently created open deal, or null. */
function pickPrimaryDeal(deals: RawDeal[] | null | undefined): Deal | null {
  const open = (deals ?? []).filter((d) => (d.status ?? "open") === "open");
  if (open.length === 0) return null;
  open.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return open[0] as Deal;
}

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags` and
 * derive `contact.primaryDeal` from the embedded `deals(...)` set. Safe to
 * call on rows fetched with {@link CONVERSATION_SELECT}; a row with no
 * contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, deals, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
      primaryDeal: pickPrimaryDeal(deals),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}
