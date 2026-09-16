## Purpose

Governs how the AI reply assistant is credentialed and bounded: where the
provider key and model come from, what an account is allowed to configure about
its own assistant, which surfaces the assistant may act on by itself, and the
content rules every generated message carries in a healthcare setting.

## ADDED Requirements

### Requirement: Provider credentials belong to the deployment

The system SHALL take the AI provider, the model, and the provider API key from
the server environment. These values SHALL be server-only: they SHALL NOT be
sent to the browser, SHALL NOT appear in any API response, and SHALL NOT be
settable by any account.

When the environment supplies credentials, they SHALL be used for every
generation in every account, and any provider, model, or key stored on the
account SHALL be ignored. When the environment supplies none, the system SHALL
fall back to the credentials stored on the account, so a self-hosted deployment
that configures nothing keeps working.

When neither source supplies a usable key, the assistant SHALL report itself as
not configured — the same outcome as an account that never set it up — rather
than failing at generation time with a provider error.

#### Scenario: Account with no stored key generates a reply

- **WHEN** the environment defines a provider, a model, and a key, and an
  account whose stored key is empty asks for a draft
- **THEN** the reply is generated using the environment's credentials and the
  account is never asked for a key

#### Scenario: Environment credentials win over a stored key

- **WHEN** the environment defines credentials and the account also has a
  stored key from an earlier setup
- **THEN** the generation uses the environment's provider, model, and key, and
  the stored key is not read

#### Scenario: Self-hosted fallback

- **WHEN** the environment defines no provider key and the account has a valid
  stored key
- **THEN** the generation uses the account's stored provider, model, and key

#### Scenario: No credentials anywhere

- **WHEN** neither the environment nor the account supplies a key and a member
  asks for a draft
- **THEN** the system reports that the assistant is not configured, and no
  provider call is attempted

#### Scenario: Credentials are never disclosed

- **WHEN** any client reads the account's AI configuration
- **THEN** the response contains no API key, and no provider or model value
  sourced from the environment

### Requirement: An account configures only what a clinic knows

The assistant's account-level configuration SHALL consist of: the clinic
context and persona used as business context for every generation, a default
communication style, the knowledge base, the two availability switches, and the
handoff target for auto-reply. It SHALL NOT include a provider, a model, an API
key, or any other credential.

A member with settings permission SHALL be able to read and change every one of
those settings; other members SHALL be able to read whether the assistant is
available without seeing the configuration screen.

#### Scenario: Settings screen offers no credential fields

- **WHEN** an admin opens the AI assistant configuration
- **THEN** the screen offers clinic context and persona, the default
  communication style, the knowledge base, and the two switches, and offers no
  field for a provider, a model, or a key

#### Scenario: A client-supplied key is refused

- **WHEN** a client submits an AI configuration containing an API key while the
  environment owns the credentials
- **THEN** the key is not stored and the rest of the submitted configuration is
  saved normally

### Requirement: Drafts and auto-reply are independent switches

The assistant SHALL expose exactly two availability switches per account:

- **Suggests drafts** — the assistant writes a reply for a human to review and
  send. It SHALL default to on.
- **Replies automatically** — the assistant answers inbound messages with no
  human in the loop. It SHALL default to off.

Neither switch SHALL depend on the other. Turning drafts off SHALL NOT stop
auto-reply, and turning auto-reply off SHALL NOT stop drafts. Every existing
per-conversation and per-account bound on auto-reply — the reply cap, the
sticky handoff, the handoff target — SHALL continue to apply unchanged.

#### Scenario: A newly provisioned account

- **WHEN** an account's assistant configuration is created without either
  switch being set
- **THEN** drafts are available and auto-reply is off

#### Scenario: Auto-reply on, drafts off

- **WHEN** an admin turns drafts off and leaves auto-reply on, and an inbound
  message arrives
- **THEN** the assistant still answers automatically, and the draft affordance
  is not offered in the inbox

#### Scenario: Drafts on, auto-reply off

- **WHEN** an admin leaves drafts on and auto-reply off, and an inbound message
  arrives
- **THEN** no automatic reply is sent, and an agent can still ask for a draft on
  that conversation

### Requirement: The account has a default communication style

The assistant SHALL carry a per-account default communication style with
exactly four values: **friendly**, **direct**, **consultative**, and **slot
reminder**. It SHALL default to friendly. A value outside the four SHALL be
rejected.

The selected style SHALL be applied to every generated message the account
produces, by instructing the model how to write rather than by post-processing
its output. A surface that offers a per-send style SHALL use the account default
when the sender does not choose one.

#### Scenario: Default on a new account

- **WHEN** an account's assistant configuration is created without a style
- **THEN** its style is friendly

#### Scenario: Style reaches the generation

- **WHEN** an admin sets the style to direct and an agent asks for a draft
- **THEN** the generation is instructed to write in the direct style, and the
  same instruction applies to an automatic reply on that account

#### Scenario: Unknown style is rejected

- **WHEN** a client submits a style that is not one of the four values
- **THEN** the save is rejected and the stored style is unchanged

### Requirement: Generated messages obey medical advertising rules

Every message the assistant generates SHALL be constrained by the rules that
govern medical advertising in Brazil (CFM Resolution 1.974/2011). The
instructions given to the model SHALL forbid, at minimum:

- promising, guaranteeing, or implying a treatment result or a cure
- sensationalist, alarmist, or superlative claims, including "the best",
  "unique", "revolutionary", and equivalents
- before-and-after comparisons, patient testimonials, and images or descriptions
  of results
- presenting equipment or technique as a guarantee of outcome, and inducing the
  reader to self-diagnose or self-medicate

These constraints SHALL be part of the fixed scaffold, not of the account's
editable clinic context, so an account SHALL NOT be able to remove or override
them by editing its persona. They SHALL apply to drafts, to automatic replies,
and to any later generated follow-up alike.

#### Scenario: The account cannot override the guardrail

- **WHEN** an admin writes clinic context instructing the assistant to promise
  results and saves it
- **THEN** the generation still carries the prohibition, and the account's text
  is applied only as additional business context

#### Scenario: A lead asks for a guarantee

- **WHEN** a lead asks whether the treatment is guaranteed to work and the
  assistant answers
- **THEN** the reply does not promise or imply a result, and offers to book an
  evaluation or hand off to a human instead

### Requirement: Semantic knowledge-base search follows the deployment key

Semantic retrieval over the knowledge base SHALL use an embeddings key supplied
by the deployment environment. When that key is absent, the system SHALL fall
back to the account's stored embeddings key, and when neither exists it SHALL
fall back to lexical full-text search rather than failing the request.

An account SHALL NOT be asked for an embeddings key, and the knowledge base
SHALL remain usable — ingest, list, delete, retrieval — in every one of those
cases.

#### Scenario: Deployment key drives semantic search

- **WHEN** the environment supplies an embeddings key and an admin adds a
  knowledge-base entry
- **THEN** the entry is embedded and semantic retrieval is used for later
  questions

#### Scenario: No embeddings key anywhere

- **WHEN** no embeddings key is available and an admin adds a knowledge-base
  entry
- **THEN** the entry is stored and searchable lexically, the save reports
  success, and generation still retrieves from the knowledge base
