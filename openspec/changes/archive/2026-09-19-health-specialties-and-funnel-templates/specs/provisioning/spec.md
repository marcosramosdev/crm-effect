## ADDED Requirements

### Requirement: The clinic specialty describes the clinic and decides nothing

The specialty SHALL record the health niche the client works in. It SHALL NOT
select the pipeline, gate a feature, change a default, or alter any behaviour of
the product; it exists to describe the clinic and to be read back by an operator.

The system SHALL offer exactly these specialties, and no others: the fourteen
health professions recognised by the Conselho Nacional de Saúde — assistente
social, biólogo, biomédico, profissional de educação física, enfermeiro,
farmacêutico, fisioterapeuta, fonoaudiólogo, médico, médico veterinário,
nutricionista, odontólogo, psicólogo, terapeuta ocupacional — plus "estética e
cosmetologia", plus "Outros".

Choosing "Outros" SHALL open a free-text field naming the niche, and that text
SHALL be required: a submission carrying "Outros" with no text SHALL be refused.
For every other specialty the free text SHALL be ignored rather than stored.

The chosen specialty SHALL be stored on the account and SHALL survive later
edits to the account's name, credentials and advertising configuration. It SHALL
NOT be readable or writable by any client-account role.

#### Scenario: The list is the sixteen values and nothing else

- **WHEN** an operator opens the specialty control
- **THEN** it offers the fourteen Conselho Nacional de Saúde professions,
  "estética e cosmetologia" and "Outros", and no other value

#### Scenario: "Outros" requires its text

- **WHEN** an operator submits the form with "Outros" chosen and the free-text
  field blank
- **THEN** the submission is refused, the field is identified as missing, and
  nothing is created

#### Scenario: "Outros" stores the free text

- **WHEN** an operator provisions an account choosing "Outros" and typing
  "quiropraxia"
- **THEN** the account records "Outros" with "quiropraxia" as its stated niche

#### Scenario: Free text is dropped for a listed specialty

- **WHEN** an operator picks a listed specialty while free text from an earlier
  keystroke is still present
- **THEN** the account records only the listed specialty and no free text

#### Scenario: The specialty changes nothing else

- **WHEN** two accounts are provisioned with the same funnel model and different
  specialties
- **THEN** their pipelines, stages, inbound landing settings and assistant
  configurations are identical

#### Scenario: A client cannot read the specialty

- **WHEN** a client session reads its own account record through any
  client-facing surface
- **THEN** the response carries neither the specialty nor its free text

### Requirement: Four funnel models seed the pipeline

The system SHALL offer exactly four funnel models, defined in the application
rather than edited by operators or clients, presented as "Modelo 1" through
"Modelo 4" with each model's stage sequence shown alongside its label so the
operator chooses by the stages, not by the number.

The models SHALL carry these stages, in this order:

1. Em contato, Follow-up, Avaliação agendada, Avaliação realizada, Orçamento
   apresentado, Procedimento agendado, Concluído, Perdido
2. Em contato, Follow-up, Consulta agendada, Consulta realizada, Tratamento
   indicado, Retorno agendado, Concluído, Perdido
3. Em contato, Follow-up, Avaliação agendada, Avaliação realizada, Proposta
   apresentada, Procedimento agendado, Concluído, Perdido
4. Em contato, Follow-up, Reunião agendada, Reunião realizada, Proposta enviada,
   Negociação, Fechado, Perdido

Every model's first stage SHALL be "Em contato", marked as the protected system
stage, and every model's last stage SHALL be "Perdido", which is an ordinary
stage.

The pipeline a model seeds SHALL be named "Funil de vendas", for all four
models: the name does not vary, only the stages do.

Choosing a model at provisioning time SHALL create the pipeline with that
model's stages in that order. A model SHALL be read once, at creation: changing
the set of models later SHALL NOT alter any account that already exists.

After provisioning, the client SHALL be free to rename, reorder, add, and remove
stages — except the system stage, which is protected.

#### Scenario: Operator picks one of the four

- **WHEN** an operator opens the provisioning form
- **THEN** it offers the four funnel models and no others, each showing its stage
  sequence

#### Scenario: Chosen model shapes the pipeline

- **WHEN** an operator provisions an account choosing the second model
- **THEN** the account's pipeline carries exactly that model's eight stages in
  that order, beginning with "Em contato" and ending with "Perdido"

#### Scenario: Every seeded pipeline carries the same name

- **WHEN** accounts are provisioned with each of the four models
- **THEN** every seeded pipeline is named "Funil de vendas", whatever the clinic
  is called

#### Scenario: Every model starts with the system stage

- **WHEN** any funnel model is used
- **THEN** the resulting pipeline's first stage is "Em contato" and is marked as
  a system stage, and no other stage is

#### Scenario: "Perdido" is an ordinary stage

- **WHEN** a client renames, recolours, reorders or deletes the "Perdido" stage
  after provisioning
- **THEN** the change is accepted, exactly as for any non-system stage

#### Scenario: Existing accounts are untouched

- **WHEN** the set of funnel models changes in a later release
- **THEN** no pipeline or stage of an already-provisioned account changes

#### Scenario: Client can still edit the rest

- **WHEN** the client renames or removes a non-system stage after provisioning
- **THEN** the change is accepted

## MODIFIED Requirements

### Requirement: One submission provisions a complete account

The system SHALL require, in a provisioning submission, the client's e-mail
address, an operator-chosen password, the clinic specialty, and the funnel model
the account's pipeline is born with. The specialty and the funnel model are
independent choices: neither constrains the other, and no combination of the two
is refused. It SHALL additionally accept, all of them optional: the clinic name,
the client's full name, the assistant's initial persona text, and the account's
advertising dataset identifier and access token.

A successful submission SHALL produce all of the following, and the account
SHALL NOT be reported as provisioned unless every one exists:

- a sign-in identity for the client's e-mail address, already confirmed, whose
  password is the one the operator chose — so the client can sign in
  immediately with no confirmation e-mail;
- an account carrying the default timezone, named after the clinic name when
  one was supplied and after the local part of the client's e-mail address when
  one was not — an account SHALL never be created nameless;
- the account's recorded specialty, with its free text when the specialty is
  "Outros";
- the client as that account's owner;
- one pipeline named "Funil de vendas", seeded from the chosen funnel model's
  stages;
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

- **WHEN** an operator submits only an e-mail address, a password, a specialty
  and a funnel model
- **THEN** every item listed above exists, the account is named after the
  e-mail's local part, and the operator is shown the address and password to
  deliver

#### Scenario: Successful provision produces a usable account

- **WHEN** an operator submits the provisioning form with valid values
- **THEN** every item listed above exists, and the operator is shown the
  client's sign-in address and password

#### Scenario: Supplied clinic name wins over the fallback

- **WHEN** an operator provisions an account supplying a clinic name
- **THEN** the account carries that name, not the e-mail's local part, and its
  pipeline is still named "Funil de vendas"

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

#### Scenario: Missing specialty or funnel model is refused

- **WHEN** a submission arrives with either the specialty or the funnel model
  absent or unrecognised
- **THEN** it is refused before any sign-in identity is created, the missing
  field is identified, and nothing is created

#### Scenario: No e-mail is sent

- **WHEN** a provision succeeds
- **THEN** the client receives no message from the system, and the credentials
  exist only on the operator's screen

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
- **THEN** the e-mail address, the password, the specialty and the funnel model
  are the only controls in view, and the remaining fields are behind one
  expandable section

#### Scenario: Event name defaults

- **WHEN** an operator leaves the conversion event name empty
- **THEN** the account reports conversions under the default event name

## REMOVED Requirements

### Requirement: Specialty templates seed the pipeline

**Reason**: The specialty no longer selects a pipeline. The two jobs the field
carried are split into the two independent requirements above — "The clinic
specialty describes the clinic and decides nothing" and "Four funnel models seed
the pipeline" — which also revokes the reduction of the specialty list to
`dentist` and `physician`.

**Migration**: Operators choose a funnel model where they used to choose a
specialty template; the dentist and physician templates no longer exist and are
refused if submitted. Accounts provisioned before this change keep the pipeline
and stages they were created with, including their pipeline's existing name;
nothing is migrated.
