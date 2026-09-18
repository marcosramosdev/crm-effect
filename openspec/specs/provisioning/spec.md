# Provisioning Specification

## Purpose

Governs how a platform operator creates a complete, ready-to-use client account
from a single internal form: who may reach that form, what one successful
submission produces, how a partial failure is reported and cleaned up, and how
the delivered credentials reach the client without the system ever mailing them.

## Requirements

### Requirement: Self-service account creation is closed

The system SHALL NOT allow a visitor to create an account for themselves. The
public sign-up surface SHALL be reachable only while carrying a team invitation
token; without one, a visitor SHALL be sent to the sign-in screen. No
operator-facing surface SHALL link to sign-up.

#### Scenario: Sign-up without an invitation is refused

- **WHEN** an unauthenticated visitor opens the sign-up address with no
  invitation token
- **THEN** they are redirected to the sign-in screen and no account is created

#### Scenario: Invited teammate still joins

- **WHEN** a person who has no account opens a valid team invitation link and
  proceeds to create their login
- **THEN** account creation succeeds and they join the inviting account, exactly
  as before this change

#### Scenario: Sign-in screen offers no way to register

- **WHEN** a visitor views the sign-in screen
- **THEN** it presents no link, button, or copy inviting them to create an
  account

### Requirement: The provisioning console is restricted to platform operators

The system SHALL restrict the provisioning console to a deployment-configured
allow-list of platform-operator e-mail addresses. Membership in that list SHALL
be the only credential that grants access; a role inside a client account SHALL
NOT grant it. A signed-in user whose address is absent from the list SHALL be
treated as though the console does not exist. Every provisioning action SHALL
re-check the allow-list on the server rather than trusting a check already made
by the browser.

#### Scenario: Listed operator reaches the console

- **WHEN** a signed-in user whose e-mail address is on the platform-operator
  allow-list opens the provisioning console
- **THEN** the console renders

#### Scenario: Ordinary client owner is turned away

- **WHEN** the owner of a client account, whose address is not on the
  allow-list, opens the provisioning console
- **THEN** they are sent away with no indication that a console exists, and no
  provisioning data is disclosed

#### Scenario: Unauthenticated visitor is turned away

- **WHEN** a visitor with no session opens the provisioning console
- **THEN** they are sent to the sign-in screen

#### Scenario: Server re-checks on submit

- **WHEN** a provisioning submission arrives from a session whose address is not
  on the allow-list
- **THEN** it is rejected and nothing is created, regardless of what the browser
  sent

#### Scenario: Allow-list is unset

- **WHEN** the deployment configures no platform-operator allow-list
- **THEN** the console is reachable by nobody

### Requirement: One submission provisions a complete account

The system SHALL accept, in one provisioning submission: the clinic name, the
client's full name, the client's e-mail address, an operator-chosen password,
the clinic specialty, the assistant's initial persona text, and the account's
advertising dataset identifier and access token.

A successful submission SHALL produce all of the following, and the account
SHALL NOT be reported as provisioned unless every one exists:

- a sign-in identity for the client's e-mail address, already confirmed, whose
  password is the one the operator chose — so the client can sign in
  immediately with no confirmation e-mail;
- an account named after the clinic, carrying the default timezone;
- the client as that account's owner;
- one pipeline seeded from the chosen specialty's stage template;
- a messaging gateway instance belonging to that account, awaiting the client's
  scan;
- the account's inbound-lead landing setting pointed at the seeded pipeline's
  system stage;
- an assistant configuration carrying the supplied persona, with automatic
  replies off and draft suggestions on;
- the supplied advertising credentials, stored encrypted.

The system SHALL NOT send any e-mail as part of provisioning. After a
successful provision the operator SHALL be shown the client's e-mail address
and password so they can deliver them through their own channel.

#### Scenario: Successful provision produces a usable account

- **WHEN** an operator submits the provisioning form with valid values
- **THEN** every item listed above exists, and the operator is shown the
  client's sign-in address and password

#### Scenario: Client signs in with the delivered credentials

- **WHEN** the client signs in with the address and password the operator
  delivered
- **THEN** sign-in succeeds on the first attempt with no e-mail confirmation
  step, and the dashboard shows the seeded pipeline

#### Scenario: Duplicate e-mail address is refused

- **WHEN** an operator submits an e-mail address that already has a sign-in
  identity
- **THEN** the submission is refused with an explanatory message and nothing is
  created

#### Scenario: Weak password is refused

- **WHEN** an operator submits a password shorter than the minimum the sign-in
  system accepts
- **THEN** the submission is refused before anything is created

#### Scenario: No e-mail is sent

- **WHEN** a provision succeeds
- **THEN** the client receives no message from the system, and the credentials
  exist only on the operator's screen

### Requirement: A partial provision is reported and cleaned up

Provisioning touches systems that cannot share one database transaction. When
any step fails, the system SHALL undo the steps already completed for that
submission, SHALL NOT leave a half-built account in place, and SHALL report to
the operator which step failed and why.

If the undo itself cannot complete, the system SHALL tell the operator exactly
what was left behind, identified precisely enough to remove by hand, rather
than reporting a clean failure.

#### Scenario: Gateway is unreachable

- **WHEN** the messaging gateway rejects or times out on the instance-creation
  step
- **THEN** the sign-in identity and account created earlier in the same
  submission are removed, the operator is told the gateway step failed, and no
  account remains

#### Scenario: Retry after a failure is clean

- **WHEN** an operator resubmits the same form after a failed provision
- **THEN** the submission behaves as a first attempt — the e-mail address is
  free, and success produces exactly one account

#### Scenario: Cleanup cannot complete

- **WHEN** a step fails and undoing an earlier step also fails
- **THEN** the operator is shown what was left behind, identified precisely
  enough to remove manually

### Requirement: Specialty templates seed the pipeline

The system SHALL offer a fixed set of specialty pipeline templates, defined in
the application rather than edited by operators or clients. Every template's
first stage SHALL be the system stage named "Em contato". Choosing a template
at provisioning time SHALL create the pipeline with that template's stages, in
the template's order.

After provisioning, the client SHALL be free to rename, reorder, add, and
remove stages — except the system stage, which is protected.

#### Scenario: Chosen template shapes the pipeline

- **WHEN** an operator provisions an account choosing the dentist template
- **THEN** the account's pipeline carries exactly that template's stages in that
  order, beginning with "Em contato"

#### Scenario: Every template starts with the system stage

- **WHEN** any specialty template is used
- **THEN** the resulting pipeline's first stage is "Em contato" and is marked as
  a system stage

#### Scenario: Client can still edit the rest

- **WHEN** the client renames or removes a non-system stage after provisioning
- **THEN** the change is accepted

### Requirement: Inbound WhatsApp leads land in the system stage

Provisioning SHALL point the account's inbound-lead landing setting at the
seeded pipeline and its system stage, so that a contact created by an inbound
WhatsApp message becomes an open deal in "Em contato" without the client
configuring anything.

#### Scenario: First inbound message creates a deal in the system stage

- **WHEN** a message arrives from a number that has no contact yet, on a freshly
  provisioned account
- **THEN** a contact and an open deal are created, and the deal sits in the
  "Em contato" stage of the seeded pipeline

#### Scenario: Client may repoint the setting

- **WHEN** the client changes the inbound landing pipeline to another pipeline
- **THEN** the change is accepted and later inbound leads land where the client
  chose

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

### Requirement: First sign-in suggests changing the delivered password

Because the operator chose the client's password, the system SHALL show the
client a dismissible banner suggesting they change it, with a direct path to
the password screen. The suggestion SHALL NOT block any action, SHALL NOT
expire the password, and SHALL stop appearing once the client changes the
password or dismisses the banner.

#### Scenario: Banner appears on first sign-in

- **WHEN** a freshly provisioned client signs in for the first time
- **THEN** a dismissible banner suggests changing the password and links to the
  password screen

#### Scenario: Dismissal sticks

- **WHEN** the client dismisses the banner
- **THEN** it does not reappear on later sign-ins

#### Scenario: Changing the password retires the banner

- **WHEN** the client changes their password
- **THEN** the banner no longer appears, whether or not it was dismissed

#### Scenario: Nothing is blocked

- **WHEN** the banner is showing
- **THEN** every other part of the application remains fully usable

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
