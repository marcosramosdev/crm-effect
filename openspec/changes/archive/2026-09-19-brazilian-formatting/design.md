## Context

See `proposal.md` — Why. What shapes the approach:

- The app locale already has one resolver: `src/i18n/request.ts` reads
  `process.env.NEXT_PUBLIC_APP_LOCALE || "pt-BR"`. next-intl exposes it to
  components through `useLocale()`, and `src/i18n/date-fns-locale.ts` already
  maps it to a date-fns `Locale`.
- The ~30 offending call sites are spread across client components
  (`"use client"` at the top of nearly all of them) and two plain modules —
  `src/lib/automations/trigger-meta.ts` and `src/lib/currency.ts` — which are
  not React and cannot call a hook.
- Deal scheduling already stores an instant and converts it through
  `src/lib/time/account-tz.ts` (`toZonedInputValue` / `fromZonedInputValue`),
  which speak the `YYYY-MM-DDTHH:mm` wall-clock string shape that
  `datetime-local` uses. The board card already renders its editor inside a
  `Popover`.
- `date-fns@^4` and the shadcn scaffolding (`components.json`, `popover`,
  `button`, `select`) are installed; `react-day-picker` and `calendar` are not.

## Goals / Non-Goals

**Goals:**

- One place decides what locale the product formats in, reachable from React
  and non-React code alike.
- One date-and-time control, used by both scheduling surfaces, that does not
  inherit anything from the browser's locale.
- A currency default change that is a column default and nothing else.

**Non-Goals:**

- Per-user or per-account locale selection. The locale stays a deployment-wide
  setting; the helpers just take an override argument so a later per-user
  locale is a change of caller, not a rewrite.
- Replacing the calendar page's month/week navigation, which is not a picker.
- Touching `src/lib/time/account-tz.ts` or `src/lib/followups/render.ts` — see
  proposal.md, Assumptions.

## Decisions

### 1. A module constant for the app locale, not hook plumbing

`src/lib/format.ts` exports `APP_LOCALE = process.env.NEXT_PUBLIC_APP_LOCALE || "pt-BR"`
— the same expression `src/i18n/request.ts` already uses — plus
`formatDate`, `formatDateTime`, `formatTime` and `formatNumber`, each taking
an optional trailing `locale` argument defaulting to `APP_LOCALE`.
`src/lib/currency.ts` imports `APP_LOCALE` and passes it where it passes
`undefined` today.

Why: `NEXT_PUBLIC_*` is inlined into the client bundle at build time, so the
constant holds the same value on server and client, and works in
`trigger-meta.ts` and `currency.ts` where `useLocale()` cannot be called.
Threading `useLocale()` through ~30 components would be the same number of
edits plus a prop or hook call in each, and would still leave the two
non-React modules needing an argument.

Alternative considered: keep `useLocale()` at every call site. Rejected for
the above; the optional `locale` argument keeps that door open, and the call
sites that already hold a locale (`src/components/calendar/period.ts`,
`src/components/notifications/pending-followups-section.tsx`) keep passing it.

Alternative considered: hardcode `"pt-BR"` in the helpers. Rejected: it
contradicts the `localization` spec's `NEXT_PUBLIC_APP_LOCALE=en` scenario for
no less code.

### 2. Mechanical replacement at the call sites

Each `x.toLocaleString()` / `new Date(iso).toLocaleDateString(...)` becomes a
call to the shared helper. No component keeps its own formatting options
inline unless it needs a shape the helpers do not offer, in which case it
passes `APP_LOCALE` explicitly to `Intl`. Verification is a grep: after the
change, no `toLocale*String(` call outside `src/lib/format.ts`,
`src/lib/currency.ts` and `src/lib/time/account-tz.ts` may be missing a locale
argument.

### 3. The date-time control: shadcn `calendar` for the day, selects for the time

`src/components/ui/calendar.tsx` comes from shadcn (react-day-picker v9),
given `locale={dateFnsLocale(APP_LOCALE)}` so month and weekday names and the
first day of the week follow the product. A new
`src/components/ui/date-time-picker.tsx` wraps it in the existing `Popover`
and adds the time.

The time half is **two selects (hour `00`–`23`, minute in 5-minute steps)**,
not `<input type="time">`: a native time input decides 12h vs 24h from the
browser's own locale, which is the exact defect this change exists to remove.
When the value being edited is not on the 5-minute grid (an existing deal at
14:37), that exact minute is added to the select's options so opening the
editor never silently moves an appointment. If arbitrary minutes are wanted
later, the minute select becomes a numeric input and nothing else changes.

The control's public shape stays the one the call sites already speak: it
takes and returns the `YYYY-MM-DDTHH:mm` wall-clock string that
`toZonedInputValue` / `fromZonedInputValue` produce and consume, so
`deal-form.tsx` and `deal-card.tsx` swap the element and keep their existing
timezone conversion, validation and save paths untouched.

Alternative considered: a third-party date-time picker package. Rejected:
shadcn `calendar` is the project's own component vocabulary, and the only new
dependency is react-day-picker, which that component requires anyway.

### 4. Currency: the column default, and only the column default

Migration `053_account_default_currency_brl.sql` runs
`ALTER TABLE accounts ALTER COLUMN default_currency SET DEFAULT 'BRL';`. No
`UPDATE`. The `accounts_default_currency_format` check from 021 is untouched.
`DEFAULT_CURRENCY` in `src/lib/currency.ts` becomes `"BRL"`, and
`src/lib/automations/engine.ts`'s literal `'USD'` fallback becomes
`DEFAULT_CURRENCY`.

Both halves are needed: the column default covers accounts created by
provisioning and by the sign-up trigger, and the app-side constant covers the
render path before an account's currency has loaded.

### 5. Unnamed members and unknown records

`memberLabel()` in `src/lib/account/members.ts` gains a translated fallback
label instead of `m.user_id`. Because `src/lib/account/members.ts` is not a
React module, the label is passed in by the caller (the components already
hold `t`), keeping the helper pure. The duplicated fallback in
`automation-builder.tsx` and the empty-string fallback in `deal-form.tsx`'s
assignee dropdown both route through it, so the rule holds in one place. The
five `messages/*.json` strings of the form `"{id} (unknown …)"` lose the
`{id}` placeholder and become plain "unknown pipeline" / "unknown stage" /
etc. text.

## Risks / Trade-offs

- **A missed call site keeps formatting in the browser's locale, silently.** →
  The grep in decision 2 is part of the work, and a unit test asserts the
  helpers' output for a known instant under `pt-BR`.
- **`APP_LOCALE` is read at build time, so changing the env var needs a
  rebuild.** → Already true of every `NEXT_PUBLIC_*` value and of next-intl's
  own resolution in `src/i18n/request.ts`; no new constraint.
- **react-day-picker is a new dependency and brings its own CSS
  expectations.** → It is shadcn `calendar`'s required peer and the component
  ships Tailwind classes matching the project's theme tokens; the risk is a
  visual mismatch, checked when the control lands, not a functional one.
- **5-minute time granularity is a product decision made here.** → The
  off-grid value is preserved on edit, so the ceiling is only on newly chosen
  times, and the upgrade path is one component.
- **A screen still shows a UUID somewhere nobody looked.** → The spec states
  the rule; the sweep covers the known sites, and the unnamed-member label
  becomes the single fallback so a new caller inherits it.

## Migration Plan

1. Ship migration 053 (default only — nothing to backfill, nothing to lock).
2. Deploy the app change. Existing accounts read their stored currency as
   before; new accounts get `BRL` from the column default.
3. Rollback: revert the app deploy, and, if needed,
   `ALTER TABLE accounts ALTER COLUMN default_currency SET DEFAULT 'USD';`.
   Accounts created while the change was live keep `BRL`, which is a stored
   value chosen by the system and not something a rollback should rewrite.
