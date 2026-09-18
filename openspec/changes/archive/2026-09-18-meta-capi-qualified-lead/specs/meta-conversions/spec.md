## Purpose

Records the outcome the clinic actually cares about — a lead that became
qualified — against the ad click that produced it, so that Click-to-WhatsApp
campaigns can eventually optimize on qualified leads instead of on replies, and
so every conversion that cannot be reported is counted rather than lost.

This capability currently covers capture and enqueue only. Delivery to Meta is
specified once the experiment in `design.md`, D0 has returned; until then a
qualified lead's conversion is recorded and held, never sent.

While that is true, a conversion awaiting delivery is waiting on a decision
rather than on a worker, and nothing expires it — the seven-day freshness check
belongs to the delivery pass that does not exist yet. An operator reading a
growing count of waiting conversions should read it as "this account would be
reporting, if reporting were switched on".

## ADDED Requirements

### Requirement: Qualifying a deal records exactly one conversion

When a deal transitions into the `qualified` status, the system SHALL record one
conversion for that deal, regardless of which surface performed the status
change. The record SHALL capture the contact's click attribution, the
qualification time, and the account's configured event name as they stood at the
moment of the transition, so that later edits to the contact or the account
cannot change what was recorded.

A deal SHALL produce at most one conversion for a given event name. A deal that
leaves `qualified` and returns SHALL NOT produce a second one.

#### Scenario: Deal qualified from any surface

- **WHEN** a deal's status changes to `qualified` from the pipeline board, the
  deal form, the contact detail view, or any server-side writer
- **THEN** one conversion exists for that deal, holding the contact's click
  identifier and the time of the transition

#### Scenario: Deal created already qualified

- **WHEN** a deal is created with the `qualified` status rather than moved into
  it
- **THEN** one conversion is recorded, exactly as for a transition

#### Scenario: Re-qualifying does not duplicate

- **WHEN** a deal that already has a conversion is moved out of `qualified` and
  back into it
- **THEN** no additional conversion is recorded

#### Scenario: Attribution is frozen at the transition

- **WHEN** a contact's click attribution changes after one of their deals was
  qualified
- **THEN** the already-recorded conversion still carries the click that was
  stored at the time of qualification

### Requirement: A conversion without a click is not recorded

A deal qualified for a contact that carries no click identifier SHALL NOT
produce a conversion. An organic conversation is an absence of paid origin, not
a failure, and SHALL NOT be counted as one.

#### Scenario: Organic contact qualified

- **WHEN** a deal is qualified for a contact whose conversation did not start
  from an ad
- **THEN** no conversion is recorded and nothing is reported anywhere as failed
  or pending

### Requirement: A conversion that cannot be reported is counted as unconfigured

When a deal is qualified for a contact that has a click, but the account has no
dataset configured, the system SHALL record the conversion in an `unconfigured`
state rather than discarding it. Such conversions SHALL be counted separately
from those awaiting delivery.

Configuring the account later SHALL NOT make historical `unconfigured`
conversions eligible for delivery.

#### Scenario: Qualified lead in an unconfigured account

- **WHEN** a deal with a click is qualified in an account that has no dataset
  identifier
- **THEN** the conversion is recorded as unconfigured, and the account's count of
  unreported conversions increases

#### Scenario: Configuring the account does not resurrect history

- **WHEN** an operator fills in the advertising configuration for an account
  that already has unconfigured conversions
- **THEN** those conversions remain unconfigured, and only conversions recorded
  after the configuration are eligible for delivery

### Requirement: Recording a conversion never blocks or breaks the user

Recording SHALL happen as part of the status change itself, with no outbound
network call in the user's request path. A user qualifying a deal SHALL see the
status change succeed at normal speed.

#### Scenario: No outbound call while qualifying

- **WHEN** a user qualifies a deal
- **THEN** the status change completes without any request to an external
  service

### Requirement: Recorded conversions are never readable by clinic users

Conversion records SHALL be accessible only to the platform's own server-side
processes. No clinic-facing session SHALL be able to read, create, or modify
them, in any form.

#### Scenario: Clinic session cannot read conversions

- **WHEN** an authenticated clinic session queries the conversion records
- **THEN** it receives nothing

### Requirement: Operators can see conversion health

The operator console SHALL report, without requiring database access: the number
of conversions awaiting delivery, the number recorded as unconfigured, and for
each account whether its advertising configuration is complete.

#### Scenario: Unreported conversions are visible

- **WHEN** an account has accumulated unconfigured conversions
- **THEN** the operator console shows that count for that account

#### Scenario: Incomplete configuration is visible

- **WHEN** an account has a dataset identifier but no access token, or neither
- **THEN** the operator console identifies that account as not reporting
