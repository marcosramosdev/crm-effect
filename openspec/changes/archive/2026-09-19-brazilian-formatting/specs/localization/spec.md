## MODIFIED Requirements

### Requirement: Locale-aware date formatting

Every number, currency amount, date and time rendered in the UI SHALL be
formatted using the app's active locale — the deployment's configured locale,
`pt-BR` unless overridden — and SHALL NOT be formatted using the locale of the
browser or operating system the viewer happens to be using, nor a locale fixed
in a single screen's code. This covers thousands separators and decimal marks,
currency symbols and their placement, date order, month and weekday names, and
relative time strings, on every user-facing surface: dashboard, inbox,
pipelines, contacts, broadcasts, calendar, notifications, settings, the
invite-acceptance page and the admin console.

#### Scenario: Relative timestamp under pt-BR locale

- **WHEN** the app locale is `pt-BR` and a component renders a relative
  timestamp (e.g. "3 days ago")
- **THEN** the rendered string uses Portuguese date vocabulary (e.g. "há 3
  dias") instead of English

#### Scenario: Viewer's browser is configured for another locale

- **WHEN** the app locale is `pt-BR` and a user views the dashboard, a
  broadcast, a deal or the admin console from a browser whose own locale is
  `en-US`
- **THEN** every date renders in Brazilian order (`19/09/2026`), every number
  uses `.` for thousands and `,` for decimals (`1.234,50`), and no value on the
  screen renders in the browser's locale

#### Scenario: Deployment overrides the locale

- **WHEN** a deployment sets `NEXT_PUBLIC_APP_LOCALE=en`
- **THEN** numbers, currency amounts and dates render under that locale
  throughout the app, for every viewer, whatever locale their browser is set to

#### Scenario: Currency amount carries its account's currency

- **WHEN** a deal value is rendered for an account whose currency is `BRL`
- **THEN** it renders as a Brazilian Real amount formatted under the active
  locale (`R$ 1.234`), and an account holding another currency renders that
  currency's symbol and grouping instead

## ADDED Requirements

### Requirement: Dates are chosen through an in-product date and time control

Wherever the user picks a date, or a date and a time together, the system SHALL
present its own in-product control rather than a browser-native date input, so
that the calendar, the order of the fields, the month and weekday names and the
first day of the week come from the app's active locale rather than from the
viewer's browser. Day and time SHALL be chosen in a single control wherever the
stored value carries both. The control SHALL read and write wall-clock time in
the account's configured timezone.

#### Scenario: Scheduling a lead

- **WHEN** a user sets the scheduled date and time of a lead, from the deal
  form or from the board card
- **THEN** they pick the day from an in-product calendar whose month and
  weekday names are in the active locale, and the time in the same control, and
  the saved instant is the wall-clock time they chose read in the account's
  timezone

#### Scenario: Viewer's browser is configured for another locale

- **WHEN** a user opens the date control from a browser whose own locale is
  `en-US` while the app locale is `pt-BR`
- **THEN** the calendar still renders Portuguese month and weekday names and
  the Brazilian field order, unchanged from what any other viewer sees

#### Scenario: Filtering by date

- **WHEN** a screen offers a date filter
- **THEN** that filter uses the same in-product control, with the same
  locale behaviour

### Requirement: Internal identifiers never reach a client-facing screen

No client-facing surface SHALL display an internal identifier — a UUID or other
opaque database key — to the user, in a picker, a label, a summary or an error
message. Where a human-readable name is unavailable, the system SHALL render a
stated placeholder describing the kind of record instead of its identifier.
Screens available only to platform operators MAY name an identifier when it is
the object of a manual recovery action the operator has to perform.

#### Scenario: Member has neither a name nor an e-mail address

- **WHEN** a member with no full name and no visible e-mail address appears in
  a picker or a label — the assistant's hand-off agent, an automation's agent
  dropdown, or a deal's assignee
- **THEN** they render under a readable "unnamed member" label, and their
  identifier appears nowhere on the screen

#### Scenario: A referenced record no longer exists

- **WHEN** an automation references a pipeline, a stage, a tag, a custom field
  or an agent that no longer exists
- **THEN** the screen states that the referenced record is unknown without
  printing its identifier

#### Scenario: An error is shown to a client

- **WHEN** an action fails on a client-facing screen
- **THEN** the message explains what failed in the active locale and contains
  no identifier
