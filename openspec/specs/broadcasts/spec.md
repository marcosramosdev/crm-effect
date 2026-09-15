# Broadcasts Specification

## Purpose

Covers bulk outbound campaigns to a filtered audience of contacts without any
approved-template requirement: composing a free-form message with per-recipient
variables, scheduling and throttled dispatch, resuming an interrupted run, and
tracking delivery per recipient.

## Requirements

### Requirement: Free-form broadcast composition

A broadcast SHALL be composed of a message body written by the user, optionally
with one attached media file and a caption, rather than a reference to an
approved template. The body MAY contain `{{variable}}` placeholders.

#### Scenario: Text-only broadcast

- **WHEN** a user composes a broadcast with body text and no attachment
- **THEN** the broadcast is saved as a draft carrying that body and can be sent
  to the selected audience

#### Scenario: Media broadcast

- **WHEN** a user attaches an image, video, document, or audio file and writes a
  caption
- **THEN** the broadcast is saved with the media reference and caption, and each
  recipient receives the media with the resolved caption

#### Scenario: Empty body is rejected

- **WHEN** a user attempts to save or send a broadcast whose body is empty and
  that has no attachment
- **THEN** the request is rejected with a validation error

#### Scenario: Template selection is no longer offered

- **WHEN** a user opens the broadcast composer
- **THEN** no approved-template picker is presented and no template approval
  status gates sending

### Requirement: Per-recipient variable substitution

The system SHALL resolve `{{variable}}` placeholders per recipient from contact
fields and custom fields before sending, and SHALL let the user supply a
fallback value for each variable.

#### Scenario: Placeholder resolved from a contact field

- **WHEN** a broadcast body contains a placeholder naming a contact field and the
  recipient has a value for it
- **THEN** that recipient receives the message with the placeholder replaced by
  their value

#### Scenario: Missing value uses the fallback

- **WHEN** a recipient has no value for a referenced field and the user supplied
  a fallback
- **THEN** the fallback is substituted for that recipient

#### Scenario: Missing value with no fallback

- **WHEN** a recipient has no value for a referenced field and no fallback was
  supplied
- **THEN** the recipient is marked failed with a reason naming the unresolved
  variable, and the rest of the run continues

#### Scenario: Preview before sending

- **WHEN** a user previews the broadcast
- **THEN** the preview renders the body resolved against a sample recipient from
  the selected audience

### Requirement: Audience selection

The system SHALL build the recipient list from a saved audience filter over
contacts, SHALL exclude contacts without a usable WhatsApp number, and SHALL
report the resulting recipient count before sending.

#### Scenario: Filtered audience

- **WHEN** a user selects an audience by tags, custom fields, or other supported
  contact filters
- **THEN** the system reports how many contacts match and stores one pending
  recipient row per matching contact

#### Scenario: Contacts without a number are excluded

- **WHEN** the filter matches contacts that have no valid phone number
- **THEN** those contacts are excluded from the recipient list and the reported
  count reflects the exclusion

#### Scenario: Empty audience

- **WHEN** the selected filter matches no contacts
- **THEN** the broadcast cannot be sent and the user is told the audience is
  empty

### Requirement: Scheduled and throttled dispatch

The system SHALL support sending immediately or at a scheduled time, and SHALL
pace sends so the gateway's rate limits are respected.

#### Scenario: Immediate send

- **WHEN** a user sends a broadcast immediately
- **THEN** the broadcast enters the sending state and recipients are dispatched
  at the configured pace until all are attempted

#### Scenario: Scheduled send

- **WHEN** a user schedules a broadcast for a future time
- **THEN** the broadcast is stored as scheduled and dispatch begins at that time

#### Scenario: Rate limit encountered mid-run

- **WHEN** the gateway reports a rate limit during dispatch
- **THEN** dispatch backs off and retries the affected recipient rather than
  marking it permanently failed

#### Scenario: Instance disconnected mid-run

- **WHEN** the WhatsApp instance is not connected at dispatch time
- **THEN** the run stops with a state that can be resumed, and remaining
  recipients stay pending rather than being marked failed

### Requirement: Resumable runs

A broadcast interrupted before every recipient was attempted SHALL be resumable,
and resuming SHALL never send twice to a recipient already attempted.

#### Scenario: Resume after interruption

- **WHEN** an authorized user resumes an interrupted broadcast
- **THEN** dispatch continues from the pending recipients only

#### Scenario: Concurrent resume attempts

- **WHEN** two resume attempts run at the same time for one broadcast
- **THEN** only one proceeds and the other is refused while the first holds the
  run

#### Scenario: Completed broadcast cannot be resumed

- **WHEN** a resume is attempted on a broadcast with no pending recipients
- **THEN** the request is refused and the broadcast remains in its final state

### Requirement: Per-recipient delivery tracking

The system SHALL record each recipient's outcome — pending, sent, delivered,
read, replied, or failed — updating it from gateway status events, and SHALL
maintain aggregate counts on the broadcast.

#### Scenario: Status progression

- **WHEN** status events report a broadcast message sent, then delivered, then
  read
- **THEN** that recipient's status advances accordingly and the broadcast's
  aggregate counts are updated

#### Scenario: Recipient replies

- **WHEN** a recipient sends an inbound message after receiving a broadcast
- **THEN** the recipient is marked replied and the replied count is updated

#### Scenario: Send failure is attributed

- **WHEN** a send to one recipient fails
- **THEN** that recipient is marked failed with the reported reason, the failed
  count is updated, and dispatch continues with the remaining recipients
