## 1. Migration (written by the agent, applied by the operator)

- [x] 1.1 Write `supabase/migrations/044_lead_scheduling.sql`, idempotent like
      `002_pipelines_enhancements.sql`: add `deals.scheduled_at TIMESTAMPTZ`,
      add `deals.appointment_confirmed_at TIMESTAMPTZ`, drop
      `deals.expected_close_date`, add
      `accounts.timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo'`, add
      `CREATE INDEX idx_deals_scheduled_at ON deals(scheduled_at)`, and — in
      this order — drop `deals_status_check`, `UPDATE deals SET status =
      'qualified' WHERE status = 'won'`, re-add the constraint as
      `CHECK (status IN ('open','qualified','lost'))`. Header comment states
      that expected close dates are discarded. Verify by reading the file back:
      the UPDATE sits between the constraint drop and the re-add.
- [x] 1.2 **STOP — hard gate.** Hand the migration to the operator and wait.
      The agent does NOT run `supabase db push`, `psql`, or any equivalent.
      Resume only when the operator confirms the migration is applied. Verify
      by the operator's explicit go-ahead; every task below assumes the new
      schema is live.

## 2. Timezone plumbing

- [x] 2.1 Add `src/lib/time/account-tz.ts` exporting `DEFAULT_TIMEZONE`
      (`'America/Sao_Paulo'`), `toZonedInputValue(iso, timeZone)` and
      `fromZonedInputValue(value, timeZone)` over `Intl.DateTimeFormat`.
      Verify with `src/lib/time/account-tz.test.ts`: a round trip returns the
      same instant, a DST boundary in `America/Sao_Paulo` maps to the right
      wall clock, and an instant near midnight lands on the expected account-
      timezone day.
- [x] 2.2 Thread `timezone` through `src/hooks/use-auth.tsx` exactly as
      `default_currency` is threaded: add it to the account `.select()`, narrow
      a missing value to `DEFAULT_TIMEZONE`, add it to `AccountSummary`, and
      expose `timeZone` on the auth context next to `defaultCurrency`. Verify
      `npm run typecheck` passes and `useAuth().timeZone` reads
      `'America/Sao_Paulo'` in the running app.
- [x] 2.3 Update `Account`/`AccountSummary` and `Deal` in `src/types/index.ts`:
      add `timezone`, replace `expected_close_date` with
      `scheduled_at?: string | null`, add
      `appointment_confirmed_at?: string | null`, and change `DealStatus` to
      `"open" | "qualified" | "lost"`. Verify `npm run typecheck` now fails
      only in the call sites that groups 3–5 fix.

## 3. Status rename across the app

- [x] 3.1 Replace `"won"` with `"qualified"` in
      `src/components/pipelines/deal-form.tsx` (status action and disabled
      check), `deal-card.tsx` (badge), `pipeline-analytics.tsx` (open-deal
      filter and the this-month stat), and
      `src/components/contacts/contact-detail-view.tsx`. Verify by grepping the
      repo for `'won'` / `"won"` in `src/` and finding no deal-status hit.
- [x] 3.2 Update the `"won"` fixtures in
      `src/lib/inbox/conversations.test.ts` to `"qualified"`. Verify
      `npm run test` passes for that file.
- [x] 3.3 Rename the three status keys in `messages/en.json`,
      `messages/pt-BR.json`, and `messages/ko.json` (`won`, `wonThisMonth`,
      `wonThisMonthTooltip` → `qualified`, `qualifiedThisMonth`,
      `qualifiedThisMonthTooltip`) with wording that matches the new meaning in
      each locale, and update the `t(...)` call sites. Verify the three files
      hold the same key set and no `won` key remains.

## 4. Scheduling replaces the close date

- [x] 4.1 Change `updateDealInline` in `src/lib/inbox/deals.ts`: the patch takes
      `scheduled_at?: string | null` (UTC ISO or `null`) instead of
      `expected_close_date`, with the doc comment updated to say instant, not
      `YYYY-MM-DD`. Verify `src/lib/inbox/deals.test.ts` is updated to the new
      field and `npm run test` passes for it.
- [x] 4.2 In `src/components/pipelines/deal-form.tsx`, replace the close-date
      field with a `datetime-local` input bound through `toZonedInputValue` /
      `fromZonedInputValue` with `useAuth().timeZone`, and reject a submitted
      date with no time. Verify in the running app: save 14:00, reload, read
      back 14:00; clear it and it reads back as not set.
- [x] 4.3 In `src/components/pipelines/deal-card.tsx`, turn the inline date
      picker into a date + time picker writing `scheduled_at`, keeping the
      existing commit-on-confirm, clear, optimistic-update, and revert-on-
      failure behavior, and render the booked time in the account timezone.
      Verify on the board: picking a date and time updates the card and
      persists without opening the detail view or changing stage; a failed
      write reverts the card.
- [x] 4.4 Replace the `expected_close_date` row-type fields in
      `src/components/pipelines/pipeline-board.tsx` (three places) and
      `src/app/(dashboard)/pipelines/page.tsx` with `scheduled_at`, including
      the deal `.select()` columns. Verify `npm run typecheck` passes and the
      board loads with booked times showing.

## 5. Calendar

- [x] 5.1 Add `src/app/(dashboard)/calendar/page.tsx` loading the account's
      deals where `scheduled_at IS NOT NULL` and `archived_at IS NULL`, across
      all pipelines, joined to the contact for the lead name, bounded by the
      visible period. Verify the page renders booked leads from two different
      pipelines in one view.
- [x] 5.2 Add `src/components/calendar/` with the month and week grids built on
      `date-fns`, bucketing each appointment by its account-timezone day key,
      a period switcher, prev/next navigation, a "today" action, a month-cell
      "+N more" indicator, and an empty-period message. Verify each against the
      scenarios in `specs/calendar/spec.md`, including a device set to another
      timezone showing the same day and time.
- [x] 5.3 Make a calendar entry open the lead's conversation the way
      `contact-detail-view.tsx` does, and show the existing "no conversation"
      toast when the deal has none. Verify both paths by clicking an entry with
      and without a linked conversation.
- [x] 5.4 Add the `calendar` namespace to `messages/{en,pt-BR,ko}.json` and the
      `/calendar` entries to `src/components/layout/sidebar.tsx` and
      `src/components/layout/header.tsx`. Verify the nav item and page title
      render translated in all three locales.

## 6. Verification

- [x] 6.1 Run `npm run typecheck`, `npm run lint`, and `npm run test` and
      verify all three are green.
- [x] 6.2 Grep the repo (excluding `node_modules` and
      `openspec/changes/archive/`) for `expected_close_date` and for the deal
      status `won` and verify there are no remaining occurrences.
- [ ] 6.3 Walk the acceptance path in the running app: book a lead from the
      deal form, see it on the board card, see it on the calendar month and
      week views, click through to its conversation, then archive the deal and
      verify it leaves both the board and the calendar.
