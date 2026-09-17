## Purpose

Reports the outcome the clinic actually cares about — a lead that became
qualified — back to Meta against the ad click that produced it, so Click-to-
WhatsApp campaigns can optimize on qualified leads instead of on replies, and
so every failure to report is visible rather than silent.

## ADDED Requirements

### Requirement: Qualifying a deal enqueues exactly one conversion event

When a deal transitions into the `qualified` status, the system SHALL record a
pending conversion event for that deal, regardless of which surface performed
the status change. The record SHALL capture the click attribution and the
qualification time at the moment of the transition, so later edits to the
contact cannot change what is reported.

A deal SHALL produce at most one conversion event for a given event name. A deal
that leaves `qualified` and returns SHALL NOT produce a second event.

#### Scenario: Deal qualified from any surface

- **WHEN** a deal's status changes to `qualified` from the pipeline board, the
  deal form, the contact detail view, or any server-side writer
- **THEN** a pending conversion event exists for that deal, holding the
  contact's click identifier and the time of the transition

#### Scenario: Re-qualifying does not duplicate

- **WHEN** a deal that already has a conversion event is moved out of
  `qualified` and back into it
- **THEN** no additional conversion event is created

#### Scenario: Contact without ad attribution

- **WHEN** a deal is qualified for a contact that has no click identifier
  because the conversation started organically
- **THEN** no conversion event is created and no request is made to Meta

#### Scenario: Account without advertising credentials

- **WHEN** a deal is qualified in an account that has no dataset identifier
  configured
- **THEN** no conversion event is created, and this is treated as an unconfigured
  account rather than as a failure

### Requirement: Conversion events are delivered as business-messaging events

The system SHALL deliver each pending conversion event to the account's
configured advertising dataset as a Conversions API server event that identifies
itself as a WhatsApp business-messaging conversion. The delivered event SHALL
carry:

- the account's configured event name, defaulting to `Lead`
- the qualification time as the event time
- an action source of `business_messaging` and a messaging channel of `whatsapp`
- the contact's click identifier as `ctwa_clid` in the customer information
- the account's WhatsApp Business Account identifier when one is configured
- the deal identifier as the event identifier

The system SHALL NOT send unhashed personal data — phone number, name, or email
— as customer information.

#### Scenario: Event reaches the dataset

- **WHEN** a pending conversion event is delivered for an account with a dataset
  identifier and access token
- **THEN** the request targets that account's dataset, carries the click
  identifier, the business-messaging action source, the WhatsApp messaging
  channel, and the deal identifier as the event identifier

#### Scenario: Event name follows account configuration

- **WHEN** an account is configured with an event name other than the default
- **THEN** the delivered event uses that name, so it can match the event the ad
  set optimizes for

#### Scenario: No personal data leaves unhashed

- **WHEN** any conversion event is delivered
- **THEN** the payload contains no plain-text phone number, name, or email

### Requirement: Delivery is asynchronous, retried, and bounded

Delivery SHALL NOT happen inside a user-facing request: qualifying a deal SHALL
succeed and return without waiting for Meta. A scheduled worker SHALL deliver
pending events, retry transient failures with increasing delay up to a bounded
number of attempts, and stop retrying an event that Meta rejects permanently.

Every attempt's outcome SHALL be recorded on the event, including the error
reported by Meta, so a failure can be diagnosed without reproducing it.

#### Scenario: Qualifying is not blocked by Meta

- **WHEN** Meta is slow or unreachable at the moment a deal is qualified
- **THEN** the status change completes normally and the event stays pending

#### Scenario: Transient failure is retried

- **WHEN** delivery fails with a network error or a retryable response
- **THEN** the event remains eligible for a later attempt, with the attempt
  count and last error recorded

#### Scenario: Permanent rejection stops retrying

- **WHEN** Meta rejects the event for a reason that will not change on retry,
  such as an invalid click identifier or an unauthorized token
- **THEN** the event is marked failed, the reason is retained, and no further
  attempts are made

#### Scenario: Attempts are bounded

- **WHEN** an event has exhausted the configured maximum number of attempts
- **THEN** it is marked failed and stops consuming worker time

### Requirement: Stale clicks are expired instead of being sent

Meta attributes a conversion only within seven days of the ad click. The system
SHALL NOT attempt delivery for an event whose click is older than that window.
Such an event SHALL be marked expired with that reason recorded, and SHALL be
counted separately from delivery failures.

#### Scenario: Click older than the attribution window

- **WHEN** a pending event's click identifier was captured more than seven days
  before the qualification time
- **THEN** the event is marked expired with the stale-click reason and no request
  is made to Meta

#### Scenario: Expired events are countable

- **WHEN** an operator reviews conversion health
- **THEN** expired events are reported separately from failed ones

### Requirement: Redelivery does not double-count a conversion

Each conversion event SHALL keep a stable event identifier across every delivery
attempt, so an event delivered twice — by a retry, a replay, or a worker running
concurrently — is counted once by Meta.

#### Scenario: Retry reuses the identifier

- **WHEN** an event is retried after a transient failure
- **THEN** the retried request carries the same event identifier as the first
  attempt

#### Scenario: Concurrent workers do not send twice

- **WHEN** two worker runs overlap
- **THEN** a given pending event is claimed by only one of them

### Requirement: Test mode is explicit and reversible

An account MAY carry a test event code. While one is present, delivered events
SHALL be marked as test events so they appear in Meta's test view without being
used for ad optimization. The operator surface SHALL show which accounts are in
test mode, so an account is not left there by accident.

#### Scenario: Test code is applied

- **WHEN** an account has a test event code configured
- **THEN** delivered events carry that code

#### Scenario: Test mode is visible

- **WHEN** an operator reviews accounts
- **THEN** accounts with a test event code configured are shown as being in test
  mode

#### Scenario: Clearing the code resumes real reporting

- **WHEN** the test event code is removed from an account
- **THEN** subsequent events are delivered as ordinary, optimizable conversions

### Requirement: Operators can see conversion delivery health

The operator console SHALL report, without requiring database access: the number
of pending, failed and expired conversion events, when the delivery worker last
ran, and for each account whether its advertising configuration is complete.

#### Scenario: Failures are visible

- **WHEN** conversion events have failed
- **THEN** the operator console shows the failure count

#### Scenario: A stalled worker is visible

- **WHEN** the delivery worker has not run recently
- **THEN** the operator console shows when it last ran

#### Scenario: Incomplete configuration is visible

- **WHEN** an account has a dataset identifier but no access token, or neither
- **THEN** the operator console identifies that account as not reporting
