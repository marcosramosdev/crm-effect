## ADDED Requirements

### Requirement: An account has a timezone that scheduled times are read against

An account SHALL carry a timezone, an IANA zone identifier, defaulting to
`America/Sao_Paulo`. Every scheduled appointment time SHALL be entered,
displayed, and grouped into calendar days against that timezone, regardless of
the timezone of the device the operator is using or of the server storing the
value.

A scheduled time SHALL be stored as an absolute instant, so changing the
account timezone SHALL NOT move an already-booked appointment to a different
absolute moment — it SHALL only change how that moment is presented.

#### Scenario: Time entered is the time read back

- **WHEN** an operator on a device set to a different timezone books a lead for
  14:00 in an account whose timezone is `America/Sao_Paulo`
- **THEN** the deal reports 14:00 for every member of that account, on every
  device, and on the next open

#### Scenario: Day boundaries follow the account timezone

- **WHEN** an appointment falls near midnight in the account's timezone
- **THEN** it is grouped into the calendar day it belongs to in that timezone,
  not into the day it would fall on in UTC or in the viewer's local zone

#### Scenario: Default timezone

- **WHEN** an account that has never had a timezone set is read
- **THEN** its timezone is `America/Sao_Paulo`

### Requirement: A deal records when the lead is booked

A deal SHALL record a **scheduled appointment time**: a date and a time of day,
not a date alone. It SHALL be optional — a deal with no booking yet SHALL
report it as not set rather than as a fabricated default.

A member with send permission SHALL be able to set, change, and clear the
scheduled time. Any member SHALL be able to read it. The stored value SHALL
survive a stage move, a pipeline move, archiving, and a status change.

A deal SHALL additionally carry an **appointment confirmation time**, recording
when the booking was confirmed by the lead. Nothing in this change sets or
displays it; it SHALL default to not set and SHALL be preserved unchanged by
every operation specified here.

#### Scenario: Book a lead

- **WHEN** an agent sets a deal's scheduled time to a date and a time of day and
  saves
- **THEN** both the date and the time are persisted and are shown on the next
  open of the deal

#### Scenario: A date without a time is rejected

- **WHEN** an agent submits a scheduled date with no time of day
- **THEN** the save is rejected, the field is identified as incomplete, and the
  previously stored scheduled time is unchanged

#### Scenario: Clearing the booking

- **WHEN** an agent clears a deal's scheduled time
- **THEN** the deal reports no scheduled time and the cleared value is
  persisted as "not set"

#### Scenario: Scheduling is optional

- **WHEN** an agent creates a deal without setting a scheduled time
- **THEN** the deal is created with no scheduled time, and surfaces that read it
  treat it as absent rather than as the current date

#### Scenario: The booking survives deal movement

- **WHEN** a deal that has a scheduled time is moved to another stage, moved to
  another pipeline, archived, or has its status changed
- **THEN** its scheduled time is unchanged

#### Scenario: Read-only member

- **WHEN** a member without send permission opens a deal
- **THEN** the scheduled time is displayed and cannot be edited

### Requirement: A qualified lead is the deal's positive status

A deal's status SHALL be one of `open`, `qualified`, or `lost`. `qualified`
SHALL be the positive outcome: the lead has been assessed and is worth booking.
No deal SHALL be able to hold a status outside that set, and a submitted status
outside it SHALL be rejected without changing the stored value.

Deals that carried the previous positive status SHALL read as `qualified` after
this change, with no other attribute of the deal altered.

#### Scenario: Mark a deal qualified

- **WHEN** an agent marks a deal as qualified
- **THEN** the deal's status becomes `qualified` and every surface that shows a
  deal status shows it as qualified

#### Scenario: Existing positive deals carry over

- **WHEN** a deal that held the previous positive status is read after this
  change
- **THEN** its status is `qualified`, and its title, value, currency, stage,
  pipeline, assignee, custom field values, notes, and archived state are
  unchanged

#### Scenario: Unknown status is rejected

- **WHEN** a status outside `open`, `qualified`, and `lost` is submitted for a
  deal
- **THEN** the write is rejected and the deal keeps its stored status

### Requirement: Edit and book a deal from the board card

An operator with send permission SHALL be able to change a deal's title, its
monetary value, and its scheduled appointment time directly on its pipeline
board card, and SHALL be able to archive the deal from the card, all without
opening the deal detail view.

Title and value edits SHALL be committed on confirmation and SHALL be
discardable without saving. Changing the scheduled appointment time SHALL let
the operator pick a date **and** a time of day, in the account's timezone, or
clear the booking, and SHALL be committed on confirmation. Archiving from the
card SHALL require an explicit confirmation step, because it removes the card
from the board.

The card SHALL update immediately on commit and the change SHALL be persisted;
a failed persist SHALL revert the card and surface an error. Editing on the
card SHALL NOT move the deal between stages, and SHALL NOT interfere with
dragging the card.

A member without send permission SHALL see no inline-edit, scheduling, or
archive affordance on the card.

#### Scenario: Rename on the card

- **WHEN** an agent edits a deal's title on its board card and confirms
- **THEN** the card shows the new title immediately and the title is persisted

#### Scenario: Discard an inline edit

- **WHEN** an agent starts editing a deal's value on the card and cancels
- **THEN** the card returns to the previously stored value and nothing is
  persisted

#### Scenario: Book from the card

- **WHEN** an agent picks a new scheduled date and time on a deal's board card
  and confirms
- **THEN** the card shows the new date and time immediately in the account's
  timezone and the value is persisted, without the deal detail view opening and
  without the deal changing stage

#### Scenario: Clear the booking from the card

- **WHEN** an agent clears the scheduled appointment time on a deal's board card
- **THEN** the card shows no scheduled time and the cleared value is persisted
  as "not set"

#### Scenario: Archive from the card requires confirmation

- **WHEN** an agent activates the archive action on a deal's board card and
  confirms the prompt
- **THEN** the deal is archived and the card is removed from the board; if the
  agent dismisses the prompt, nothing changes

#### Scenario: Failed persist reverts

- **WHEN** an inline edit or an archive from the card cannot be persisted
- **THEN** the card reverts to the previous title, value, scheduled time, or
  archived state and an error is shown

#### Scenario: Read-only member

- **WHEN** a member without send permission views the board
- **THEN** deal cards offer no inline editing, scheduling, or archive
  affordance

### Requirement: An archived deal keeps its status and its booking

A deal SHALL carry an **archived** state that is independent of its `open` /
`qualified` / `lost` status. A deal SHALL default to not archived.

A member with send permission SHALL be able to archive a deal and to unarchive
it. Archiving SHALL change only the archived state: the deal's title, value,
currency, stage, pipeline, status, assignee, scheduled appointment time, custom
field values, notes, and creation history SHALL be preserved. Unarchiving SHALL
return the deal to its existing stage and pipeline.

An archived deal SHALL NOT appear on the pipeline board and SHALL NOT be
included in any stage's deal count or value total, nor in the board analytics.
While a custom field filter is active, its per-stage counts and totals SHALL
also exclude archived deals.

The system SHALL provide a way to review the archived deals of a pipeline and
to unarchive one from there. Archiving and unarchiving SHALL be reflected on
the board without a reload; a failed persist SHALL leave the deal in its
previous state and surface an error.

#### Scenario: Archiving removes the deal from the board

- **WHEN** an agent archives a deal that is showing in a stage column
- **THEN** the card is removed from the board immediately, the change is
  persisted, and the deal is not shown again on the board until it is
  unarchived

#### Scenario: Counts and totals exclude archived deals

- **WHEN** a stage column shows a deal count and value total and one of its
  deals is archived
- **THEN** the count drops by one and the total drops by that deal's value,
  and the board analytics reflect the reduced set

#### Scenario: Archived state is independent of the deal status

- **WHEN** an agent archives a deal whose status is `qualified`
- **THEN** the deal is archived and its status stays `qualified`; unarchiving it
  later restores it to the board with status still `qualified`

#### Scenario: Review and restore an archived deal

- **WHEN** an agent opens the pipeline's archived-deals view and unarchives a
  deal
- **THEN** the deal appears again on the board at its existing stage and is
  counted again in that stage's count and total

#### Scenario: Archiving preserves the deal

- **WHEN** a deal with a value, a scheduled appointment time, custom field
  values, notes, and an assignee is archived and then unarchived
- **THEN** the deal keeps the same identifier and all of those fields unchanged

#### Scenario: Failed archive persist is surfaced

- **WHEN** an archive or unarchive cannot be persisted
- **THEN** the deal returns to its previous archived state on the board and an
  error is shown

#### Scenario: Read-only member sees the archived state

- **WHEN** a member without send permission views the board or a deal
- **THEN** the archived state is visible but no archive or unarchive affordance
  is offered

## REMOVED Requirements

### Requirement: Rename a deal and change its value from the board card

**Reason**: The card's date affordance edited `expected_close_date`, a date with
no hour, which this change removes. The requirement is replaced rather than
edited because both its name and the field it edits change.

**Migration**: Replaced by "Edit and book a deal from the board card". Title and
value inline editing and card archiving are unchanged. The date picker becomes a
date **and** time picker writing the scheduled appointment time in the account's
timezone; recorded expected close dates are discarded, since a forecast date has
no hour to promote it to and is not a booking.

### Requirement: A deal can be archived

**Reason**: Its text and one of its scenarios were written against the `won`
status, which this change renames to `qualified`, and archiving must now also
preserve the scheduled appointment time.

**Migration**: Replaced by "An archived deal keeps its status and its booking",
which carries the same behavior with the renamed status and the booking added to
the list of preserved attributes. No archived deal changes state.
