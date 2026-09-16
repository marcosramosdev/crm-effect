## Context

See `proposal.md` — Why. The relevant current state:

- `deals.expected_close_date DATE` (migration 001) is read and written in five
  places: `deal-form.tsx`, `deal-card.tsx` (inline picker), `pipeline-board.tsx`
  and `pipelines/page.tsx` (row types only), and `updateDealInline` in
  `src/lib/inbox/deals.ts`.
- `deals_status_check CHECK (status IN ('open','won','lost'))` was installed by
  migration 002, which also normalised a pre-existing `'active'` default. That
  migration is the template for 044: idempotent constraint drop, data
  normalisation, constraint re-add.
- `accounts` (migration 017) already gained a per-account scalar the same shape
  as the one this change needs: `default_currency` (migration 021). It is read
  once in `use-auth.tsx` (`.select("id, name, default_currency")`), narrowed
  with a fallback constant, and exposed on `AccountSummary` / `useAuth()`.
- `date-fns@4` is already a dependency; `recharts`, `@dnd-kit`, and `@base-ui`
  cover the existing UI surfaces. Nothing new is needed for a month/week grid.

## Goals / Non-Goals

**Goals:**

- One field answers "when is this lead coming in", with an hour.
- Appointment times mean the same thing for every member of an account,
  independent of device timezone.
- The calendar is a read surface over existing deal rows, with no new write
  path and no new table.

**Non-Goals:**

- No timezone picker UI. `accounts.timezone` gets a column and a default; the
  settings control to change it is a later change.
- No reminder, confirmation flow, or follow-up queue.
  `appointment_confirmed_at` is a column with no reader and no writer here.
- No recurring appointments, no duration/end time — an appointment is a single
  instant, so the week view places it at a time, it does not draw a block.

## Decisions

### Store an instant, render in the account timezone

`scheduled_at TIMESTAMPTZ` stores an absolute instant. The account's IANA zone
decides how that instant is written into an input and read out of one.

Two pure functions in `src/lib/time/account-tz.ts` do the conversion, built on
`Intl.DateTimeFormat(.., { timeZone })`:

- `toZonedInputValue(iso, timeZone)` → the `YYYY-MM-DDTHH:mm` string a
  `datetime-local` input wants, showing the wall-clock time in that zone.
- `fromZonedInputValue(value, timeZone)` → the UTC ISO instant that wall-clock
  time corresponds to in that zone.

`Intl` is in the platform, knows every zone's DST history, and is already what
the app's date formatting goes through. The alternatives were worse:
`@date-fns/tz` is a new dependency for two functions, and storing a naive local
string gives up ordering and makes "what is booked this week" a string compare.

The round trip `fromZonedInputValue(toZonedInputValue(x))` is the one piece of
non-obvious logic in this change, so it gets `src/lib/time/account-tz.test.ts`
covering a DST boundary in `America/Sao_Paulo`, a non-DST instant, and midnight
(the day-boundary scenario in the spec).

### `accounts.timezone` rides the `default_currency` path

`use-auth.tsx` already selects an account scalar, narrows a missing value to a
constant, and hands it to the tree through `AccountSummary`. `timezone` follows
that exact path: added to the `.select()`, narrowed to `DEFAULT_TIMEZONE`
(`'America/Sao_Paulo'`), exposed as `account.timezone` and as a convenience
`timeZone` on the auth context next to `defaultCurrency`.

No new provider, no new fetch. Every scheduling surface (deal form, board card,
calendar) reads it from `useAuth()`.

### `expected_close_date` is dropped, not migrated

There is no honest conversion from a forecast date to a booked appointment: the
hour does not exist, and a date the operator entered as "I expect to close
around here" is not a time the lead agreed to come in. Backfilling
`scheduled_at` from it would fill the new calendar with appointments nobody
booked. The column is dropped and its values go with it. This is stated in the
spec delta's migration note and is the reason the migration is run by hand.

### Status rename in one migration, following 002

Order inside `044`: drop `deals_status_check` → `UPDATE deals SET status =
'qualified' WHERE status = 'won'` → re-add the constraint with the new value
set. Reversing the first two would make the UPDATE fail the old constraint.

There is no compatibility window: the `DealStatus` union, the CHECK constraint,
and the locale keys all flip together. This is a single-tenant clinic app with
one deploy target, so a dual-value transition would be more code and more risk
than a short window where an old tab can write a rejected status — which the
existing error surface already reports.

### The calendar is a read-only view over `deals`

`src/app/(dashboard)/calendar/page.tsx` is a client page in the existing
dashboard shell, mirroring `pipelines/page.tsx`: it loads deals with
`scheduled_at IS NOT NULL AND archived_at IS NULL` joined to the contact for the
lead name, across all pipelines, for the visible period plus a margin.

`src/components/calendar/` holds the grid. `date-fns` supplies
`startOfMonth`/`endOfMonth`/`startOfWeek`/`eachDayOfInterval`; bucketing an
appointment into a day uses the account-timezone day key from the helper above,
not the browser's. Month cells cap visible entries and show a "+N" indicator;
the week view lists a day's entries ordered by instant.

Clicking an entry routes to the lead's conversation the same way
`contact-detail-view.tsx` already does; an entry whose deal has no
`conversation_id` shows the existing toast instead of navigating.

Sidebar (`layout/sidebar.tsx`) and header title map (`layout/header.tsx`) each
gain one `/calendar` line, matching the `/pipelines` entries.

### The migration is applied by the operator, by hand

The agent writes `supabase/migrations/044_lead_scheduling.sql` and then stops.
The operator runs it against the database and says to continue; the agent does
not run `supabase db push`, `psql`, or any equivalent. Every code task after
that point assumes the new schema is live, so the stop is a hard gate in
`tasks.md`, not a suggestion.

## Risks / Trade-offs

- **Dropping `expected_close_date` destroys data** → It is a forecast date on a
  pre-launch pipeline, and the migration is run by the operator who can dump the
  column first if any row matters. Called out in the spec delta and in the
  migration's header comment.
- **Code and schema flip together; a stale browser tab can write `'won'`** →
  The constraint rejects it, the existing error path surfaces it, and a reload
  fixes it. Acceptable for one deploy target and one clinic.
- **`Intl`-based zone conversion is subtle around DST** → Pinned by
  `account-tz.test.ts` with a DST-boundary case. If it ever needs more,
  `@date-fns/tz` is the upgrade path.
- **A pipeline with many booked leads makes the calendar query wide** →
  The query is bounded by the visible period and filtered on
  `scheduled_at`/`archived_at`; an index on `deals(scheduled_at)` ships in 044.
- **`appointment_confirmed_at` is a column nothing uses** → Deliberate: it is
  cheaper to add both timestamps in one hand-run migration than to ask the
  operator for a second one when the reminder change lands. It stays NULL and
  no code reads it.
