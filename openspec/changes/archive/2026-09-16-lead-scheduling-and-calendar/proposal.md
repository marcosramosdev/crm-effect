## Why

The clinic books leads at a specific time of day, but a deal can only record
`expected_close_date DATE` — a calendar day with no hour. Every downstream piece
of the roadmap (appointment reminders, the follow-up queue, an agenda view)
needs a timestamp, not a date. The pipeline status `won` is also the wrong
vocabulary: the clinic does not "win" a deal at this stage, it qualifies a lead
and books them.

## What Changes

- **BREAKING** Remove `deals.expected_close_date` and every read and write of
  it. Replace it with `deals.scheduled_at TIMESTAMPTZ` — the date *and* time the
  lead is booked for.
- Add `deals.appointment_confirmed_at TIMESTAMPTZ` as a column only. No UI
  writes or reads it in this change; a later reminder/confirmation change owns
  it.
- Add `accounts.timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo'`. Scheduled
  times are entered, stored, and displayed against the account's timezone so a
  booking does not shift when an operator travels or a server runs in UTC.
- **BREAKING** Rename deal status `won` to `qualified` across the CHECK
  constraint, existing rows, the `DealStatus` type, the pipeline and contact
  components, and the three locale files.
- Board card inline editing keeps its close-date affordance but now edits
  `scheduled_at` as date + time in the account timezone, replacing the
  date-only picker.
- New read-only `/calendar` route: month and week views of every non-archived
  deal in the account that has a `scheduled_at`, across all pipelines, showing
  the lead's name and the booked time. Clicking an entry opens that lead's
  conversation.

## Capabilities

### New Capabilities

- `calendar`: a read-only month and week agenda of the account's scheduled
  leads, and navigation from an entry to the lead's conversation.

### Modified Capabilities

- `deals`: deals carry a scheduled appointment timestamp instead of an expected
  close date; the board-card inline edit requirement changes from a date to a
  date + time; the `won` status becomes `qualified`.

## Impact

- Database: `supabase/migrations/044_lead_scheduling.sql` — drops
  `deals.expected_close_date`, adds `deals.scheduled_at` and
  `deals.appointment_confirmed_at`, adds `accounts.timezone`, rewrites the
  `deals_status_check` constraint and backfills `won` rows to `qualified`.
  **The migration is run manually by the operator**, not by the agent.
- Types: `src/types/index.ts` — `DealStatus`, the `Deal` shape, `Account`.
- Pipelines UI: `deal-form.tsx`, `deal-card.tsx`, `pipeline-board.tsx`,
  `pipeline-analytics.tsx`, `src/app/(dashboard)/pipelines/page.tsx`.
- Contacts UI: `src/components/contacts/contact-detail-view.tsx`.
- Persistence: `src/lib/inbox/deals.ts` (`updateDealInline` patch shape) and
  its test, `src/lib/inbox/conversations.test.ts` fixtures.
- i18n: `messages/{en,pt-BR,ko}.json` — the `won` labels, the close-date labels,
  and a new `calendar` namespace.
- New route and components: `src/app/(dashboard)/calendar/page.tsx`,
  `src/components/calendar/*`, plus a sidebar entry in
  `src/components/layout/sidebar.tsx` and a header title in
  `src/components/layout/header.tsx`.
- Dependencies: none added. `date-fns` is already installed and covers the
  month/week grid math.

## Out of Scope

Dragging a calendar entry to reschedule, creating a booking from the calendar,
reschedule history, and attendance/no-show tracking.
