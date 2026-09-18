# Meta Conversions Specification

## Purpose

Records the leads an operator marks as worth reporting — against the ad click
that produced each one — so that Click-to-WhatsApp campaigns can eventually
optimize on real conversions instead of on replies, and so every conversion that
cannot be reported is counted rather than lost.

This capability currently covers capture and enqueue only. Delivery to Meta is
specified once the probe described in D0 of
`openspec/changes/archive/2026-09-18-meta-capi-qualified-lead/design.md` has
returned; until then a marked lead's conversion is recorded and held, never sent.

While that is true, a conversion awaiting delivery is waiting on a decision
rather than on a worker, and nothing expires it — the seven-day freshness check
belongs to the delivery pass that does not exist yet. An operator reading a
growing count of waiting conversions should read it as "this account would be
reporting, if reporting were switched on".

## Requirements

### Requirement: Marking a deal records exactly one conversion

A deal SHALL carry a **conversion mark**: an explicit, operator-set decision
that this lead is worth reporting to the ad platform. The mark SHALL be
independent of the deal's `open` / `qualified` / `lost` status and SHALL default
to unset.

When a deal's conversion mark is set, the system SHALL record one conversion for
that deal, regardless of which surface set it. The record SHALL capture the
contact's click attribution, the instant the mark was set, and the account's
configured event name as they stood at that moment, so that later edits to the
contact or the account cannot change what was recorded.

A change of a deal's status SHALL NOT record a conversion, and SHALL NOT alter
one already recorded. Moving a deal between pipeline stages, archiving it, or
reopening it SHALL likewise record nothing.

A deal SHALL produce at most one conversion for a given event name. A deal whose
mark is cleared and set again SHALL NOT produce a second one.

#### Scenario: Deal marked from any surface

- **WHEN** an operator sets a deal's conversion mark
- **THEN** one conversion exists for that deal, holding the contact's click
  identifier and the instant the mark was set

#### Scenario: Qualifying no longer reports

- **WHEN** a deal's status changes to `qualified` and its conversion mark is not
  set
- **THEN** no conversion is recorded, and the status change is otherwise
  unaffected

#### Scenario: Moving a card reports nothing

- **WHEN** a deal is dragged to another pipeline stage, archived, or reopened
- **THEN** no conversion is recorded and no existing conversion changes state

#### Scenario: Deal created already marked

- **WHEN** a deal is created with its conversion mark already set rather than
  marked afterwards
- **THEN** one conversion is recorded, exactly as for a later mark

#### Scenario: Re-marking does not duplicate

- **WHEN** a deal that already has a delivered or awaiting conversion is
  unmarked and marked again
- **THEN** no additional conversion is recorded

#### Scenario: Attribution is frozen at the mark

- **WHEN** a contact's click attribution changes after one of their deals was
  marked
- **THEN** the already-recorded conversion still carries the click that was
  stored at the time of the mark

### Requirement: A conversion without a click is not recorded

A deal marked for reporting whose contact carries no click identifier SHALL NOT
produce a conversion. An organic conversation is an absence of paid origin, not
a failure, and SHALL NOT be counted as one.

#### Scenario: Organic contact marked

- **WHEN** a deal is marked for a contact whose conversation did not start from
  an ad
- **THEN** no conversion is recorded and nothing is reported anywhere as failed
  or pending

### Requirement: A conversion that cannot be reported is counted as unconfigured

When a deal is marked for a contact that has a click, but the account has no
dataset configured, the system SHALL record the conversion in an `unconfigured`
state rather than discarding it. Such conversions SHALL be counted separately
from those awaiting delivery.

Configuring the account later SHALL NOT make historical `unconfigured`
conversions eligible for delivery.

#### Scenario: Marked lead in an unconfigured account

- **WHEN** a deal with a click is marked in an account that has no dataset
  identifier
- **THEN** the conversion is recorded as unconfigured, and the account's count of
  unreported conversions increases

#### Scenario: Configuring the account does not resurrect history

- **WHEN** an operator fills in the advertising configuration for an account
  that already has unconfigured conversions
- **THEN** those conversions remain unconfigured, and only conversions recorded
  after the configuration are eligible for delivery

### Requirement: Recording a conversion never blocks or breaks the user

Recording SHALL happen as part of the write that sets the mark, with no outbound
network call in the user's request path. An operator marking a deal SHALL see
the mark take effect at normal speed, and a failure to record the conversion
SHALL NOT prevent the mark itself from being stored.

#### Scenario: No outbound call while marking

- **WHEN** an operator marks a deal
- **THEN** the mark is stored without any request to an external service

#### Scenario: Recording failure does not cost the mark

- **WHEN** the conversion cannot be recorded for a deal whose mark is being set
- **THEN** the mark is still stored and the operator's action still succeeds
### Requirement: Clearing the mark cancels an undelivered conversion

When a deal's conversion mark is cleared, any conversion for that deal that has
not yet been delivered SHALL be moved to a `canceled` state, whether it was
awaiting delivery or recorded as unconfigured. A conversion already delivered
SHALL be left untouched: the ad platform cannot un-learn it, and the record
SHALL keep saying what was actually reported.

Setting the mark again on a deal whose conversion was canceled SHALL return that
conversion to the state a first mark would have produced, carrying the click
attribution and mark time as they stand at that moment. Clearing the mark SHALL
never be a one-way door.

#### Scenario: Unmarking cancels a waiting conversion

- **WHEN** an operator clears the conversion mark on a deal whose conversion is
  awaiting delivery
- **THEN** that conversion is canceled and is no longer counted as awaiting
  delivery

#### Scenario: Unmarking cancels an unconfigured conversion

- **WHEN** an operator clears the conversion mark on a deal whose conversion was
  recorded as unconfigured
- **THEN** that conversion is canceled and no longer counted as unreported

#### Scenario: A delivered conversion is not cancelable

- **WHEN** an operator clears the conversion mark on a deal whose conversion was
  already delivered
- **THEN** the delivered conversion is unchanged and the record still shows it
  as delivered

#### Scenario: Re-marking after a cancel

- **WHEN** an operator sets the conversion mark again on a deal whose conversion
  was canceled
- **THEN** that conversion is again eligible for delivery — or again recorded as
  unconfigured if the account still has no dataset — carrying the current click
  attribution and the new mark time

### Requirement: Canceled conversions are never delivered

A canceled conversion SHALL NOT be selected for delivery, SHALL NOT be retried,
and SHALL NOT be counted among the conversions awaiting delivery or among those
recorded as unconfigured.

#### Scenario: Delivery skips canceled conversions

- **WHEN** conversions are selected for delivery to the ad platform
- **THEN** canceled conversions are not among them, in the same way unconfigured
  ones are not

### Requirement: Conversions recorded before the mark existed are not delivered

Conversions recorded by the earlier rule — one per deal whose status became
`qualified`, with no operator decision behind them — SHALL NOT be delivered.
They SHALL be treated as canceled, so that switching delivery on never sends a
conversion nobody chose to send.

#### Scenario: Historical automatic conversions do not ship

- **WHEN** delivery to the ad platform is switched on for the first time
- **THEN** no conversion recorded before the conversion mark existed is sent

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
