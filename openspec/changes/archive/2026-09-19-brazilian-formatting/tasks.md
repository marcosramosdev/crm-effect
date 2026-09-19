## 1. Shared formatting helper

- [x] 1.1 Create `src/lib/format.ts` exporting `APP_LOCALE`
      (`process.env.NEXT_PUBLIC_APP_LOCALE || "pt-BR"`, the same expression
      `src/i18n/request.ts` uses) plus `formatNumber`, `formatDate`,
      `formatTime` and `formatDateTime`, each taking an optional trailing
      `locale` defaulting to `APP_LOCALE`; verify `npm run typecheck` passes
- [x] 1.2 Add `src/lib/format.test.ts` asserting, for one fixed instant and
      one fixed number, Brazilian output under the default locale
      (`19/09/2026`, `1.234,50`) and English output when `"en"` is passed;
      verify `npx vitest run src/lib/format.test.ts` passes
- [x] 1.3 Replace the two `Intl.NumberFormat(undefined, …)` calls in
      `src/lib/currency.ts` with `APP_LOCALE`, and change `DEFAULT_CURRENCY`
      from `"USD"` to `"BRL"`; verify `npx vitest run src/lib/currency.test.ts`
      passes after updating the expectations in that file to Brazilian output

## 2. Sweep the locale-less call sites

- [x] 2.1 Dashboard: `src/app/(dashboard)/dashboard/page.tsx` (metric tiles and
      the delta suffix), `src/components/dashboard/activity-feed.tsx`,
      `src/components/dashboard/conversations-chart.tsx` (axis and tooltip
      labels); verify each rendered number and date is Brazilian with the
      browser set to `en-US`
- [x] 2.2 Broadcasts: `src/app/(dashboard)/broadcasts/page.tsx`,
      `src/app/(dashboard)/broadcasts/[id]/page.tsx` (counts, created date,
      sent/delivered/read timestamps),
      `src/components/broadcasts/step2-select-audience.tsx`,
      `src/components/broadcasts/step4-schedule-send.tsx`; verify the same way
- [x] 2.3 Contacts, inbox and pipelines:
      `src/app/(dashboard)/contacts/page.tsx` (drop the hardcoded `en-US`),
      `src/components/contacts/contact-detail-view.tsx`,
      `src/components/inbox/contact-sidebar.tsx`,
      `src/components/pipelines/deal-card.tsx` (drop the hardcoded `en-US` in
      `formatScheduled`), `src/components/pipelines/deal-form.tsx` (note
      timestamps); verify the same way
- [x] 2.4 Admin console: `src/components/admin/account-conversions.tsx`,
      `src/components/admin/account-lifecycle.tsx`,
      `src/components/admin/account-list.tsx` (deactivated and paired
      timestamps), `src/components/admin/operator-register.tsx`; verify the
      same way
- [x] 2.5 Remaining surfaces: `src/app/join/[token]/page.tsx`,
      `src/components/connection/connection-manager.tsx`,
      `src/components/settings/api-keys-settings.tsx`,
      `src/components/settings/members-tab.tsx`,
      `src/components/settings/profile-form.tsx`,
      `src/lib/automations/trigger-meta.ts`; verify the same way
- [x] 2.6 Confirm `src/components/calendar/period.ts` and
      `src/components/notifications/pending-followups-section.tsx` already
      receive the app locale from their callers, and leave
      `src/lib/time/account-tz.ts` (parsing, not display) and
      `src/lib/followups/render.ts` (outbound message text) untouched
- [x] 2.7 Verify the sweep is complete: a repo grep for
      `toLocaleString(|toLocaleDateString(|toLocaleTimeString(` returns no
      call without a locale argument outside `src/lib/format.ts`,
      `src/lib/currency.ts` and `src/lib/time/account-tz.ts`; then run
      `npm run lint && npm run typecheck && npm test`

## 3. Brazilian Real as the default currency

- [x] 3.1 Add `supabase/migrations/053_account_default_currency_brl.sql` with
      `ALTER TABLE accounts ALTER COLUMN default_currency SET DEFAULT 'BRL';`
      and no `UPDATE`; verify by applying it locally and checking that an
      account row inserted without a currency gets `BRL` while an existing
      `USD` row is unchanged
      — file created; live apply/verify needs a DB push (no DB access in this
      environment), handed to the user
- [x] 3.2 Replace the literal `'USD'` fallback in
      `src/lib/automations/engine.ts` with `DEFAULT_CURRENCY` from
      `src/lib/currency.ts`; verify `npx vitest run src/lib/automations`
      passes
- [x] 3.3 Verify a freshly provisioned account displays deal values in
      Brazilian Real end to end (provision through the console, create a deal,
      read the board card), and that an account already holding `USD` still
      renders dollars
      — verified by the user after pushing migration 053

## 4. Date and time picker

- [x] 4.1 Install the shadcn `calendar` component (`npx shadcn@latest add
      calendar`) and its `react-day-picker` peer; verify
      `src/components/ui/calendar.tsx` exists, `react-day-picker` is in
      `package.json`, and `npm run build` succeeds
      — also fixed: the registry generated `import { cn } from "cn"`, a new
      dependency inconsistent with every other `ui/*` file; repointed to
      `@/lib/utils` and removed the stray `cn` package
- [x] 4.2 Pass `locale={dateFnsLocale(APP_LOCALE)}` (from
      `src/i18n/date-fns-locale.ts`) to the calendar; verify month and weekday
      names render in Portuguese with the browser set to `en-US`
- [x] 4.3 Create `src/components/ui/date-time-picker.tsx`: the calendar inside
      the existing `Popover`, plus hour (`00`–`23`) and minute (5-minute step)
      selects, taking and returning the `YYYY-MM-DDTHH:mm` wall-clock string
      the current inputs use; verify a unit test covers that an off-grid
      incoming value (e.g. `14:37`) is offered as an option and round-trips
      unchanged when only the day is edited
- [x] 4.4 Replace the `datetime-local` input in
      `src/components/pipelines/deal-form.tsx` with the new control, keeping
      the existing `toZonedInputValue` / `fromZonedInputValue` conversion and
      save path; verify scheduling a lead stores the same instant it did
      before for the same chosen wall-clock time
- [x] 4.5 Replace the `datetime-local` input in the board card's popover in
      `src/components/pipelines/deal-card.tsx` with the new control, keeping
      the clear-schedule button and the commit-on-change behaviour; verify
      setting and clearing a schedule from the card still works
      — kept the card's own Popover/trigger/clear button; swapped only the
      native input for `DateTimeFields`, the popover-content-only half of the
      new control (no popover-in-popover)
- [x] 4.6 Add the picker's labels (month/time field labels, clear action) to
      `messages/en.json` and `messages/pt-BR.json`; verify
      `npx vitest run src/i18n/messages.test.ts` passes (key parity)

## 5. No internal identifiers on client-facing screens

- [x] 5.1 Change `memberLabel()` in `src/lib/account/members.ts` to fall back
      to a caller-supplied readable label instead of `m.user_id`, and update
      its caller in `src/components/settings/ai-config.tsx`; verify
      `npm run typecheck` passes and a member with no name and no e-mail
      renders the placeholder
- [x] 5.2 Route the duplicated fallback in
      `src/components/automations/automation-builder.tsx` (agent dropdown) and
      the empty-label fallback in `src/components/pipelines/deal-form.tsx`
      (assignee dropdown) through `memberLabel()`; verify neither dropdown can
      render a UUID or a blank option
      — deal-form.tsx's assignee dropdown had no id fallback (just a blank
      option), but routed through `memberLabel()` too for the same readable
      placeholder instead of blank; widened `memberLabel()`'s parameter type
      structurally so it also accepts `Profile`, not only `AccountMember`
- [x] 5.3 Remove the `{id}` placeholder from the five `unknown …` strings in
      `messages/en.json` and `messages/pt-BR.json` (tag, custom field, agent,
      pipeline, stage) and drop the now-unused argument at the call sites in
      `automation-builder.tsx`; verify `npx vitest run src/i18n` passes and an
      automation referencing a deleted pipeline shows no identifier
- [x] 5.4 Add the unnamed-member label to both catalogs; verify key parity
      with `npx vitest run src/i18n/messages.test.ts`
- [x] 5.5 Verify no client-facing UUID remains: grep the dashboard, inbox,
      pipelines, contacts, broadcasts and settings components for renders of
      `user_id`, `.id` and `{id}` in user-visible text, and confirm the only
      remaining identifier-bearing strings are the admin console's
      `cleanupIncomplete` and `orphanInstance` recovery messages

## 6. Close out

- [x] 6.1 Run `npm run lint && npm run typecheck && npm test && npm run build`
      and confirm all four pass
      — lint: 0 errors (66 pre-existing warnings, unrelated to this change);
      typecheck: clean; test: 1204/1206 (2 pre-existing failures in
      `src/lib/dashboard/date-utils.test.ts`, confirmed present on `main`
      before this change too — a timezone-dependent `new Date("2026-05-18")`
      parsing issue unrelated to formatting); build: succeeds
- [x] 6.2 Walk the app once with the browser locale set to `en-US`: dashboard,
      a broadcast, a deal (schedule it), contacts, settings and the admin
      console show Brazilian numbers and dates throughout, and no UUID
      — verified by the user
