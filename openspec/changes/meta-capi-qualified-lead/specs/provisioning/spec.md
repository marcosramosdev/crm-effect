## MODIFIED Requirements

### Requirement: Advertising credentials are invisible to the client

The account's advertising credentials — dataset identifier, access token,
WhatsApp Business Account identifier, conversion event name, and test event code
— SHALL be supplied only through provisioning. The access token SHALL be stored
encrypted at rest. No client-facing surface — page, API response, or export —
SHALL disclose the token, and no client-side role SHALL be able to read or change
any of these values.

#### Scenario: Credentials are absent from client responses

- **WHEN** any client session reads its own account record through any
  client-facing surface
- **THEN** the response contains neither the dataset identifier nor the access
  token, in any form

#### Scenario: Token is encrypted at rest

- **WHEN** the stored account record is inspected directly
- **THEN** the access token is not readable as plain text

#### Scenario: Client cannot write the credentials

- **WHEN** a client session attempts to set any of these credentials directly
- **THEN** the attempt is rejected

## ADDED Requirements

### Requirement: Provisioning captures the conversion reporting configuration

The provisioning form SHALL accept, alongside the dataset identifier and access
token, the account's WhatsApp Business Account identifier, the conversion event
name to report (defaulting to `Lead`), and an optional test event code.

These fields SHALL be optional at provisioning time: an account with no dataset
identifier is provisioned successfully and simply does not report conversions
until an operator fills them in. An operator SHALL be able to edit them after
provisioning without re-provisioning the account.

The form SHALL state, next to these fields, that the event name must match the
event the account's ad set optimizes for, because nothing in the system can
verify or enforce that.

#### Scenario: Provisioning without advertising credentials

- **WHEN** an operator provisions an account leaving the advertising fields empty
- **THEN** the account is created and usable, and is reported as not yet
  reporting conversions

#### Scenario: Filling credentials after the fact

- **WHEN** an operator edits an existing account's advertising credentials
- **THEN** the new values take effect for subsequent conversions without any
  other change to the account

#### Scenario: Event name defaults

- **WHEN** an operator leaves the conversion event name empty
- **THEN** the account reports conversions under the default event name
