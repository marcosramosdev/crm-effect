## MODIFIED Requirements

### Requirement: Advertising credentials are invisible to the client

The account's advertising configuration — dataset identifier, access token, Page
identifier, conversion event name, test event code, and the customer-information
flag — SHALL be supplied only by a platform operator. The access token SHALL be
stored encrypted at rest. No client-facing surface — page, API response, or
export — SHALL disclose the token, and no client-side role SHALL be able to read
or change any of these values.

#### Scenario: Credentials are absent from client responses

- **WHEN** any client session reads its own account record through any
  client-facing surface
- **THEN** the response contains neither the dataset identifier nor the access
  token, in any form

#### Scenario: Token is encrypted at rest

- **WHEN** the stored account record is inspected directly
- **THEN** the access token is not readable as plain text

#### Scenario: Client cannot write the credentials

- **WHEN** a client session attempts to set any of these values directly
- **THEN** the attempt is rejected

## ADDED Requirements

### Requirement: The advertising configuration covers conversion reporting

The account's advertising configuration SHALL include, alongside the dataset
identifier and access token: the identifier of the Facebook Page the account's
Click-to-WhatsApp ads run from, the conversion event name to report (defaulting
to `Lead`), an optional test event code, and a flag controlling whether hashed
customer information is included in reported conversions.

All of these SHALL be optional at provisioning time: an account with no dataset
identifier is provisioned successfully and simply does not report conversions.

#### Scenario: Provisioning without advertising configuration

- **WHEN** an operator provisions an account leaving the advertising fields
  empty
- **THEN** the account is created and usable, and is reported as not yet
  reporting conversions

#### Scenario: Event name defaults

- **WHEN** an operator leaves the conversion event name empty
- **THEN** the account reports conversions under the default event name

### Requirement: Operators can change the advertising configuration after provisioning

A platform operator SHALL be able to edit an account's advertising configuration
without re-provisioning the account. The edit surface SHALL be restricted to
platform operators by the same allow-list that guards provisioning, and SHALL
re-check that authorization on submission rather than trusting the caller.

#### Scenario: Filling credentials after the fact

- **WHEN** an operator edits an existing account's advertising configuration
- **THEN** the new values take effect for subsequent conversions, with no other
  change to the account

#### Scenario: A non-operator cannot reach the edit surface

- **WHEN** a signed-in user who is not a platform operator submits a change to
  an account's advertising configuration
- **THEN** the request is rejected and nothing is written

### Requirement: Sharing customer information is off until an operator turns it on

The flag that adds hashed customer information to reported conversions SHALL
default to off for every account, including newly provisioned ones. It SHALL be
changeable only by a platform operator.

The operator surface SHALL state, next to the flag, that turning it on requires
that account's own consent or privacy-policy basis for sharing a patient's
contact details with an advertising platform.

#### Scenario: New account does not share customer information

- **WHEN** an account is provisioned
- **THEN** its conversions carry no customer information beyond the ad click
  identifier

#### Scenario: The precondition is stated where the switch is

- **WHEN** an operator views the advertising configuration
- **THEN** the consent precondition is shown next to the flag that enables it

### Requirement: The setup procedure is stated where the credentials are entered

The operator surface SHALL state, next to the advertising fields, that the
conversion event name must match the event the account's ad set optimizes for,
and SHALL carry the short setup procedure — create or reuse the dataset in the
operator's own business, share it with the client's ad account, generate its
access token, validate with a test event code, then clear the code.

The surface SHALL also warn, for as long as a test event code is present, that
the account is in test mode. An account left in test mode reports nothing for
optimization while appearing fully configured.

Nothing in the system can verify or enforce the campaign's own configuration, so
this is documentation, not validation.

#### Scenario: Procedure is visible to the operator

- **WHEN** an operator opens the advertising configuration for an account
- **THEN** the event-name warning and the setup steps are shown alongside the
  fields

#### Scenario: Test mode is called out

- **WHEN** an account has a test event code set
- **THEN** the operator surface marks that account as being in test mode
