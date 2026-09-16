# Localization Specification

## Purpose

Defines the app's default display language and the guarantee that every
user-facing screen renders fully in the configured locale, with no
untranslated or mixed-language text reaching the user.

## Requirements

### Requirement: Default locale is Brazilian Portuguese
The system SHALL render the UI in Brazilian Portuguese (`pt-BR`) when no
explicit locale override is configured for the deployment.

#### Scenario: Fresh deployment with no locale override
- **WHEN** the app is started without setting `NEXT_PUBLIC_APP_LOCALE`
- **THEN** all pages render in Brazilian Portuguese, and `<html lang>` is
  `pt-BR`

#### Scenario: Deployment explicitly overrides the locale
- **WHEN** a deployment sets `NEXT_PUBLIC_APP_LOCALE=en`
- **THEN** all pages render in English, and `<html lang>` is `en`

### Requirement: Full translation coverage of user-facing text
Every screen in the application (authentication, dashboard, and
invite-acceptance flows) SHALL source its user-facing text from the active
locale's translation catalog rather than from strings hardcoded in a single
language.

#### Scenario: Auth pages render in the active locale
- **WHEN** a user visits the login, signup, or forgot-password page under the
  `pt-BR` locale
- **THEN** all labels, headings, validation messages, and error text on that
  page appear in Portuguese

#### Scenario: Invite acceptance renders in the active locale
- **WHEN** a user opens a `/join/<token>` invite link under the `pt-BR` locale
- **THEN** all labels, headings, and error text on that page appear in
  Portuguese

#### Scenario: Dashboard modules render in the active locale
- **WHEN** a user views the Agents or Notifications page under the `pt-BR`
  locale
- **THEN** all headings, descriptions, and status messages appear in
  Portuguese, including messages that today fall back to a hardcoded string
  when an API error has no translated equivalent

### Requirement: Translation catalog key parity across locales
Every message key present in one locale's catalog SHALL also be present in
every other supported locale's catalog, so no locale can render a raw
fallback string or a missing-key error in place of translated text.

#### Scenario: New key added for one locale
- **WHEN** a new user-facing string is added and given a key in
  `messages/en.json`
- **THEN** the same key exists with a translated value in
  `messages/pt-BR.json` and in every other locale catalog shipped in the repo

### Requirement: Locale-aware date formatting
Dates and relative time strings rendered in the UI SHALL be formatted using
the active locale's date formatting rules rather than a fixed locale.

#### Scenario: Relative timestamp under pt-BR locale
- **WHEN** the app locale is `pt-BR` and a component renders a relative
  timestamp (e.g. "3 days ago")
- **THEN** the rendered string uses Portuguese date vocabulary (e.g. "há 3
  dias") instead of English
