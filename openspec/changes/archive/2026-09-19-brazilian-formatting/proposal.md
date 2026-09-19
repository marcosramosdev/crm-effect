## Why

The product is Brazilian, its default locale is `pt-BR`, and every screen is
already translated — but the numbers, money and dates on those screens are not.
Around thirty call sites format with `toLocaleString()` / `toLocaleDateString()`
and no locale argument, which means each of them renders in the locale of the
browser that happens to be looking: a client on an English-configured machine
reads "9/19/2026" and "1,234" inside an otherwise Portuguese screen, and two
sites hardcode `en-US` outright. The currency default has the same shape of
problem from the other end: `accounts.default_currency` has defaulted to `USD`
since migration 021, so every new Brazilian clinic is born quoting deals in
dollars until someone notices the setting.

Two smaller presentation defects travel with the same release. Lead scheduling
is a raw `datetime-local` input, whose calendar, first day of week and
date order come from the browser rather than from the product. And when a
member has neither a name nor an e-mail, the UI falls back to printing their
`user_id` — a UUID — into a dropdown the client is supposed to read.

## What Changes

- **Every user-facing number, currency value and date formats in the app's
  active locale** — `pt-BR` unless a deployment sets `NEXT_PUBLIC_APP_LOCALE` —
  instead of in the viewer's browser locale. This covers the dashboard metric
  tiles, the broadcast list and detail screens, the contacts list, the inbox
  contact sidebar, the pipeline cards and deal form, the calendar, the
  notifications list, settings, the invite-acceptance page and the admin
  console. The two hardcoded `en-US` display sites go with them.
- The formatting rule gets **one place to live**: the currency helpers in
  `src/lib/currency.ts` stop passing `undefined` as the locale, and date and
  number formatting gain a shared helper next to them, so a new screen inherits
  the behaviour instead of re-deciding it.
- **New accounts are born with `BRL`.** The column default on
  `accounts.default_currency` moves from `USD` to `BRL`, and the app-side
  fallbacks that spell `USD` follow. **Accounts that already exist keep the
  currency they have** — changing the currency of an account in operation
  silently reinterprets the value of every deal in it, so the migration touches
  the default only, never a row.
- **Lead scheduling gets a real date and time picker.** The shadcn `calendar`
  component (react-day-picker, over the `date-fns` already in the project) is
  installed and wrapped in a single control that takes the day and the time
  together, replacing the `datetime-local` inputs in the deal form and on the
  board card. The control renders its month names and weekday headers in the
  active locale, and keeps reading and writing wall-clock time in the account's
  timezone exactly as the inputs do today.
- **No internal identifier reaches a client-facing screen.** A member with no
  name and no e-mail renders as a stated "unnamed member" label rather than as
  their `user_id`; the same fallback in the automation builder's agent dropdown
  and the empty label in the deal form's assignee dropdown go with it. The five
  `{id} (unknown …)` strings in the automation builder — tag, custom field,
  agent, pipeline, stage — stop printing the identifier. This is a standing
  rule, not a list: no screen shows a UUID to a client, in a picker, in a label
  or in an error message.

Non-goals: translating anything (the catalogs are complete), changing the
currency of an existing account, changing which currencies are offered,
introducing a date-range filter where none exists today, and changing how
instants are stored or how the account timezone is resolved.

Assumptions recorded here rather than asked:

- **Admin recovery messages keep their identifiers.** `cleanupIncomplete` and
  `orphanInstance` in the admin console name an auth user, an account or a
  gateway instance that a platform operator must go and remove by hand; the
  identifier is the object of the action, and the audience is staff, not a
  client. The no-UUID rule is scoped to client-facing surfaces.
- **`deals.currency`'s own column default stays `USD`.** Flipping it to `BRL`
  would mis-stamp a deal inserted without an explicit currency inside an
  existing dollar account. Every code path that creates a deal already passes
  the account's currency, so the default is unreachable in practice and safer
  left where it is.
- **`src/lib/time/account-tz.ts` keeps `en-US`.** Its two
  `Intl.DateTimeFormat("en-US")` calls are a parsing device (`formatToParts`
  against a fixed, predictable output), not display, and changing the locale
  there would break timezone conversion.
- **`src/lib/followups/render.ts` keeps its fixed `pt-BR`.** That text is the
  body of a WhatsApp message sent to a contact, not UI chrome; it is correct
  that it does not follow a deployment's UI locale override.

## Capabilities

### New Capabilities

None. Both halves belong to capabilities that already exist.

### Modified Capabilities

- `localization`: the existing locale-aware date requirement is widened from
  dates to every formatted number, currency amount and date, and stated as
  "the app's active locale, never the viewer's browser locale"; a new
  requirement says date and time are chosen through one in-product control
  rendered in the active locale rather than through a browser-native input;
  a new requirement forbids internal identifiers in client-facing text.
- `provisioning`: the account a submission produces is stated to carry the
  default currency as well as the default timezone, and that default is
  Brazilian Real for every newly created account, with existing accounts left
  untouched.

## Impact

- Schema: new migration `053` altering `accounts.default_currency`'s column
  default from `'USD'` to `'BRL'`. No `UPDATE`, no backfill, no data touched;
  the `^[A-Z]{3}$` check from 021 stays as it is.
- Shared code: `src/lib/currency.ts` (`DEFAULT_CURRENCY`, `formatCurrency`,
  `formatCurrencyShort`) and a new date/number formatting helper beside it;
  `src/lib/automations/engine.ts`'s hardcoded `'USD'` fallback.
- UI, formatting: roughly thirty call sites across
  `src/app/(dashboard)/{dashboard,broadcasts,contacts}`, `src/app/join/[token]`,
  `src/components/{admin,broadcasts,calendar,connection,contacts,dashboard,inbox,notifications,pipelines,settings}`
  and `src/lib/automations/trigger-meta.ts`.
- UI, date picker: new `src/components/ui/calendar.tsx` (shadcn) plus a
  date-time control wrapping it; `src/components/pipelines/deal-form.tsx` and
  `src/components/pipelines/deal-card.tsx` as its callers.
- UI, identifiers: `src/lib/account/members.ts` (`memberLabel`),
  `src/components/automations/automation-builder.tsx`,
  `src/components/pipelines/deal-form.tsx`.
- Dependencies: `react-day-picker` added (shadcn `calendar`'s peer);
  `date-fns@^4` is already installed.
- Translations: new keys under `messages/en.json` and `messages/pt-BR.json` for
  the unnamed-member label and the reworded `unknown …` strings, with key
  parity preserved.
