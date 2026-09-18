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
- an account carrying the default timezone, named after the clinic name when
  one was supplied and after the local part of the client's e-mail address when
  one was not — an account SHALL never be created nameless;
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

### Requirement: Specialty templates seed the pipeline

The system SHALL offer exactly two specialty pipeline templates — the dentist
and the physician — defined in the application rather than edited by operators
or clients. Every template's first stage SHALL be the system stage named "Em
contato". Choosing a template at provisioning time SHALL create the pipeline
with that template's stages, in the template's order. When the operator chooses
nothing, the dentist template SHALL be used.

After provisioning, the client SHALL be free to rename, reorder, add, and
remove stages — except the system stage, which is protected.

#### Scenario: Operator picks one of the two

- **WHEN** an operator opens the provisioning form
- **THEN** it offers the dentist and the physician templates and no others

#### Scenario: Chosen template shapes the pipeline

- **WHEN** an operator provisions an account choosing the dentist template
- **THEN** the account's pipeline carries exactly that template's stages in that
  order, beginning with "Em contato"

#### Scenario: Unchosen specialty falls back

- **WHEN** an operator provisions an account without touching the specialty
  control
- **THEN** the account's pipeline carries the dentist template's stages

#### Scenario: Every template starts with the system stage

- **WHEN** any specialty template is used
- **THEN** the resulting pipeline's first stage is "Em contato" and is marked as
  a system stage

#### Scenario: Client can still edit the rest

- **WHEN** the client renames or removes a non-system stage after provisioning
- **THEN** the change is accepted

### Requirement: The advertising configuration covers conversion reporting

The account's advertising configuration SHALL include, alongside the dataset
identifier and access token: the identifier of the Facebook Page the account's
Click-to-WhatsApp ads run from, the conversion event name to report (defaulting
to `Lead`), an optional test event code, and a flag controlling whether hashed
customer information is included in reported conversions.

All of these SHALL be optional at provisioning time: an account with no dataset
identifier is provisioned successfully and simply does not report conversions.
The provisioning form SHALL present them as a secondary, collapsed section, so
that the fields an operator fills in later never stand between them and
creating an account.

#### Scenario: Provisioning without advertising configuration

- **WHEN** an operator provisions an account leaving the advertising fields
  empty
- **THEN** the account is created and usable, and is reported as not yet
  reporting conversions

#### Scenario: Optional fields do not obstruct creation

- **WHEN** an operator opens the provisioning form
- **THEN** the e-mail address, the password and the specialty are the only
  controls in view, and the remaining fields are behind one expandable section

#### Scenario: Event name defaults

- **WHEN** an operator leaves the conversion event name empty
- **THEN** the account reports conversions under the default event name
