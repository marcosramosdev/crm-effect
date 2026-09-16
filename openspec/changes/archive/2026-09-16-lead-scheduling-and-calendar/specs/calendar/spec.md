## Purpose

Gives the clinic one read-only agenda of every lead booked across the account:
a month view and a week view of scheduled appointments, and a way to jump from
an appointment straight to that lead's conversation. It answers "who is coming
in, and when" without opening each pipeline board.

## ADDED Requirements

### Requirement: A calendar shows the account's scheduled leads

The system SHALL provide a calendar surface that displays every deal in the
account that has a scheduled appointment time and is not archived, drawn from
**all** pipelines rather than one selected pipeline.

A deal with no scheduled appointment time SHALL NOT appear. An archived deal
SHALL NOT appear, and archiving a deal SHALL remove it from the calendar.
Status SHALL NOT filter the calendar: an `open`, a `qualified`, and a `lost`
deal that each carry a scheduled time SHALL all be shown.

Each entry SHALL show the lead's name and the appointment's time of day,
rendered in the account's timezone. The calendar SHALL be readable by any
member of the account.

#### Scenario: Booked leads across pipelines appear together

- **WHEN** an operator opens the calendar in an account whose leads are spread
  over two pipelines
- **THEN** the scheduled leads from both pipelines are shown in the same
  calendar, each with the lead's name and appointment time

#### Scenario: Unscheduled deals are absent

- **WHEN** an account holds deals with no scheduled appointment time
- **THEN** none of them appear on the calendar

#### Scenario: Archived deals are absent

- **WHEN** a deal that was showing on the calendar is archived
- **THEN** it no longer appears on the calendar, and unarchiving it brings it
  back at the same appointment time

#### Scenario: Status does not hide an appointment

- **WHEN** a deal with a scheduled appointment time is marked `lost`
- **THEN** its appointment is still shown on the calendar

#### Scenario: Times are shown in the account timezone

- **WHEN** a member whose device is set to another timezone opens the calendar
- **THEN** each appointment shows the same time of day and falls on the same
  calendar day as it does for every other member of the account

### Requirement: The calendar offers a month view and a week view

The calendar SHALL offer a month view and a week view, and the operator SHALL be
able to switch between them and to move to the previous or next period without
losing the chosen view. The surface SHALL make clear which period is being
displayed and SHALL offer a way to return to the current period.

Both views SHALL place each appointment on the calendar day it falls on in the
account's timezone. The week view SHALL order a day's appointments by time of
day. When a day holds more appointments than the month view can show, the month
view SHALL indicate that more exist rather than silently dropping them.

A period with no appointments SHALL be shown as an empty calendar rather than as
an error or a blank page.

#### Scenario: Switch between month and week

- **WHEN** an operator viewing the month switches to the week view
- **THEN** the week containing the displayed period is shown with its
  appointments ordered by time of day

#### Scenario: Move to another period

- **WHEN** an operator moves to the next period
- **THEN** the appointments of that period are shown, the chosen view is kept,
  and the displayed period is identified

#### Scenario: Return to the current period

- **WHEN** an operator who has navigated away activates the "today" affordance
- **THEN** the view returns to the period containing the current date in the
  account's timezone

#### Scenario: A crowded day in the month view

- **WHEN** a day holds more appointments than the month cell can display
- **THEN** the cell indicates that further appointments exist on that day

#### Scenario: Empty period

- **WHEN** an operator opens a period with no scheduled leads
- **THEN** the calendar is shown with no entries and communicates that nothing
  is booked, without an error

### Requirement: An appointment opens the lead's conversation

Activating a calendar entry SHALL take the operator to the conversation of the
lead that appointment belongs to, so the calendar is a way into the thread
rather than a dead end.

When the lead has no conversation, activating the entry SHALL tell the operator
so and SHALL leave the calendar as it was, rather than failing silently or
navigating to an empty thread.

The calendar SHALL NOT offer any way to create, move, reschedule, or delete an
appointment; it is read-only.

#### Scenario: Open the conversation from an appointment

- **WHEN** an operator activates a calendar entry for a lead that has a
  conversation
- **THEN** that conversation is opened

#### Scenario: Lead without a conversation

- **WHEN** an operator activates a calendar entry for a lead that has no
  conversation
- **THEN** the operator is told there is no conversation and remains on the
  calendar

#### Scenario: The calendar does not edit bookings

- **WHEN** an operator with send permission views the calendar
- **THEN** no affordance is offered to create a booking, to drag an appointment
  to another day or time, or to delete one
