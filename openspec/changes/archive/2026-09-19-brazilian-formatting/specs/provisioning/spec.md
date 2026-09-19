## MODIFIED Requirements

### Requirement: One submission provisions a complete account

The system SHALL require, in a provisioning submission, only the client's
e-mail address and an operator-chosen password. It SHALL additionally accept,
all of them optional: the clinic name, the client's full name, the assistant's
initial persona text, and the account's advertising dataset identifier and
access token. The clinic specialty SHALL always carry a value, because it
selects the pipeline the account is born with; when the operator chooses none,
the system SHALL use a stated default template.

A successful submission SHALL produce all of the following, and the account
SHALL NOT be reported as provisioned unless every one exists:

- a sign-in identity for the client's e-mail address, already confirmed, whose
  password is the one the operator chose — so the client can sign in
  immediately with no confirmation e-mail;
- an account carrying the default timezone and the default currency, named
  after the clinic name when one was supplied and after the local part of the
  client's e-mail address when one was not — an account SHALL never be created
  nameless;
- the client as that account's owner;
- one pipeline seeded from the chosen specialty's stage template;
- a messaging gateway instance belonging to that account, awaiting the client's
  scan;
- the account's inbound-lead landing setting pointed at the seeded pipeline's
  system stage;
- an assistant configuration carrying the supplied persona, or an empty persona
  when none was supplied, with automatic replies off and draft suggestions on;
- any supplied advertising credentials, stored encrypted.

The system SHALL NOT send any e-mail as part of provisioning. After a
successful provision the operator SHALL be shown the client's e-mail address
and password so they can deliver them through their own channel.

#### Scenario: Address and password alone provision an account

- **WHEN** an operator submits only an e-mail address and a password
- **THEN** every item listed above exists, the account is named after the
  e-mail's local part, and the operator is shown the address and password to
  deliver

#### Scenario: Successful provision produces a usable account

- **WHEN** an operator submits the provisioning form with valid values
- **THEN** every item listed above exists, and the operator is shown the
  client's sign-in address and password

#### Scenario: Supplied clinic name wins over the fallback

- **WHEN** an operator provisions an account supplying a clinic name
- **THEN** the account carries that name, not the e-mail's local part

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

#### Scenario: Missing address or password is refused

- **WHEN** an operator submits the form with either the e-mail address or the
  password blank
- **THEN** the submission is refused and nothing is created

#### Scenario: No e-mail is sent

- **WHEN** a provision succeeds
- **THEN** the client receives no message from the system, and the credentials
  exist only on the operator's screen

## ADDED Requirements

### Requirement: A new account's default currency is Brazilian Real

Every account created after this change SHALL carry Brazilian Real (`BRL`) as
its default currency unless a currency is supplied explicitly at creation, and
that default SHALL hold whichever path created the account. An account that
already exists SHALL keep the currency it holds: no migration, backfill or
deployment step SHALL rewrite the currency of an existing account, because
reinterpreting the stored value of its deals in another currency is silently
destructive. An account's owner SHALL remain free to change the currency
themselves in settings.

#### Scenario: Operator provisions a new account

- **WHEN** an operator provisions an account and supplies no currency
- **THEN** the account's default currency is `BRL`, and new deals in it are
  valued and displayed in Brazilian Real

#### Scenario: Account that predates the change

- **WHEN** an account created before this change holds `USD` as its default
  currency
- **THEN** it still holds `USD` afterwards, and the displayed value of every
  deal in it is unchanged

#### Scenario: Owner changes the account currency

- **WHEN** the owner of an account selects a different currency in settings
- **THEN** the account carries the selected currency, and the change is not
  undone by any later deployment
