/** One booked lead on the calendar — a projection of a `Deal` row. */
export interface CalendarEntry {
  dealId: string;
  leadName: string;
  /** UTC ISO instant (`deals.scheduled_at`). */
  scheduledAt: string;
  conversationId: string | null;
}
