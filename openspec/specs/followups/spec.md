# Followups Specification

## Purpose

Defines how the system prepares a follow-up message for a lead — an appointment
reminder or an outreach to a lead who went quiet — how a human reviews and
releases it before it can leave the account, and what happens when the lead
answers. No message this capability produces is ever delivered without a person
releasing it.

## Requirements

### Requirement: An account configures how its reminders are prepared

An account SHALL carry its own follow-up configuration, editable by a member
with admin permission and readable by any member of the account:

- **Reminder offsets** — between zero and three lead times before the
  appointment, each a positive duration. The default SHALL be 5 days, 1 day,
  and 2 hours. Configuring zero offsets SHALL disable reminder preparation for
  that account without affecting anything else in this capability.
- **Reminder template** — the text every reminder is rendered from. It SHALL
  support the placeholders `{nome}`, `{data}`, `{hora}` and `{medico}`, and
  SHALL reject a save that contains a placeholder token outside that set.
- **Stale-lead threshold** — the number of days of silence after which a lead
  is treated as stale. It SHALL default to 15 and SHALL be a positive whole
  number.

A submission with more than three offsets, a duplicate offset, a non-positive
offset, a non-positive threshold, or an unknown placeholder SHALL be rejected
as a whole, leaving the stored configuration unchanged.

#### Scenario: Defaults on an account that has never configured follow-ups

- **WHEN** an account's follow-up configuration is read before anyone has
  edited it
- **THEN** it reports three offsets of 5 days, 1 day and 2 hours, a stale-lead
  threshold of 15 days, and a reminder template containing the four placeholders

#### Scenario: A fourth offset is refused

- **WHEN** an admin submits four reminder offsets
- **THEN** the save is rejected with an explanation, and the previously stored
  offsets are unchanged

#### Scenario: An unknown placeholder is refused

- **WHEN** an admin saves a template containing `{convenio}`
- **THEN** the save is rejected, the offending placeholder is named, and the
  stored template is unchanged

#### Scenario: Zero offsets disables reminders

- **WHEN** an admin saves an empty list of offsets and a lead is booked
  afterwards
- **THEN** no reminder is prepared for that lead, and the account's other
  follow-up features keep working

#### Scenario: An agent cannot change the configuration

- **WHEN** a member with agent permission submits a change to the offsets or
  the template
- **THEN** the change is rejected and the stored configuration is unchanged

### Requirement: A booked lead produces one pending follow-up per configured offset

For every deal that has a future appointment time, the system SHALL prepare one
follow-up per configured reminder offset, at the moment that offset's lead time
is reached. A prepared follow-up SHALL start in the **pending** state, which
means *awaiting a human decision* and never *scheduled to send*.

A prepared follow-up SHALL carry the message body rendered at preparation time
from the account's template, with `{nome}` replaced by the lead's name,
`{data}` and `{hora}` by the appointment's date and time expressed in the
account's timezone, and `{medico}` by the professional recorded on the deal. A
placeholder with no value available SHALL render as empty text; the literal
placeholder token SHALL NOT reach the lead.

There SHALL be at most one follow-up per deal and offset. Re-running
preparation SHALL NOT produce a second row for a pair that already has one,
whatever state that row is in. A deal with no appointment time, a deal whose
appointment is already in the past, an archived deal, and a deal whose status
is `lost` SHALL produce no follow-ups.

Preparation SHALL NOT contact the lead, the WhatsApp gateway, or any external
service.

#### Scenario: Three offsets produce exactly three follow-ups

- **WHEN** an account with the default three offsets books a lead for a date
  far enough ahead, and preparation runs repeatedly until the appointment
- **THEN** exactly three follow-ups exist for that deal, one per offset, and no
  message has been sent

#### Scenario: Preparation is idempotent

- **WHEN** preparation runs twice over the same due offset for the same deal
- **THEN** the second run creates nothing and the first row's state and body are
  untouched

#### Scenario: The body is rendered once, at preparation time

- **WHEN** a follow-up has been prepared and an admin afterwards edits the
  account's reminder template
- **THEN** the already-prepared follow-up still carries the body it was rendered
  with, and only follow-ups prepared after the edit use the new template

#### Scenario: The appointment time is rendered in the account's timezone

- **WHEN** an account in `America/Sao_Paulo` prepares a reminder for an
  appointment stored as an absolute instant
- **THEN** `{data}` and `{hora}` read as the local date and time a person in
  that timezone would see, not as UTC

#### Scenario: A missing professional leaves no trace in the text

- **WHEN** a reminder is prepared for a deal that records no professional
- **THEN** `{medico}` renders as empty text and the lead never sees the literal
  `{medico}`

#### Scenario: A lost deal prepares nothing

- **WHEN** a deal with a future appointment is marked lost and preparation runs
- **THEN** no new follow-up is prepared for it

### Requirement: An unreleased follow-up expires on its own

A follow-up that has not been sent by the time its appointment has passed SHALL
move to the **expired** state. An expired follow-up SHALL leave the pending
list, SHALL NOT be sendable, and SHALL remain readable as a record of what was
prepared and not released.

Expiry SHALL NOT alter the deal, the conversation, or the appointment.

#### Scenario: Nobody acted before the appointment

- **WHEN** a pending follow-up's appointment time passes with no approval and no
  rejection
- **THEN** the follow-up becomes expired, disappears from the pending list, and
  no message is sent

#### Scenario: An expired follow-up cannot be revived

- **WHEN** a member tries to approve or send an expired follow-up
- **THEN** the action is refused and the follow-up stays expired

#### Scenario: A sent follow-up is not expired

- **WHEN** a follow-up was sent before the appointment and the appointment then
  passes
- **THEN** the follow-up remains in the sent state

### Requirement: No follow-up leaves the account without a human release

A prepared follow-up SHALL be delivered only as the direct result of a member
with agent permission or above releasing it. There SHALL be no configuration,
no schedule, and no automatic path by which a prepared follow-up is delivered
without that action.

Every pending follow-up in the account SHALL be listed for every member with
agent permission or above, showing the lead, the appointment time, and the
exact body that would be sent. The list SHALL offer three actions:

- **Approve** — releases the follow-up as written. On successful delivery it
  becomes **sent**; if delivery fails, the approval is preserved, the failure is
  reported, and the follow-up remains releasable.
- **Reject** — moves the follow-up to **rejected**, which is terminal. Nothing
  is sent and the lead is not contacted.
- **Edit and send** — lets the member change the body before releasing it. The
  edited text SHALL be what is delivered and what is recorded as the sent body.

A member with read-only permission SHALL see the list and SHALL NOT be offered
any of the three actions. Each transition SHALL record who made it and when.
A follow-up that has already left the pending state SHALL NOT accept a second
decision.

#### Scenario: Nothing is sent until someone approves

- **WHEN** a follow-up has been pending past its offset and nobody has acted
- **THEN** the lead has received no message, whatever the account's settings

#### Scenario: Approve sends the reminder as written

- **WHEN** an agent approves a pending follow-up and delivery succeeds
- **THEN** the message reaches the lead with the listed body, the follow-up is
  sent, and the approver and time are recorded

#### Scenario: Edit changes what is delivered

- **WHEN** an agent edits the body and sends
- **THEN** the lead receives the edited text, and the stored body is the edited
  text rather than the original rendering

#### Scenario: Reject is terminal

- **WHEN** an agent rejects a pending follow-up
- **THEN** no message is sent, the follow-up is rejected, and it cannot later be
  approved

#### Scenario: A delivery failure does not lose the decision

- **WHEN** an agent approves a follow-up and the send fails at the gateway
- **THEN** the failure is shown, the follow-up is not marked sent, and the agent
  can retry without re-preparing it

#### Scenario: Two agents act on the same follow-up

- **WHEN** one agent approves a follow-up and a second agent submits a decision
  on the same follow-up immediately afterwards
- **THEN** the second decision is refused and the lead receives exactly one
  message

#### Scenario: Read-only member

- **WHEN** a member with read-only permission opens the pending list
- **THEN** the pending follow-ups are visible and approve, reject and edit are
  unavailable

#### Scenario: Another account's queue is invisible

- **WHEN** a member requests a follow-up belonging to an account they are not a
  member of
- **THEN** the request fails and nothing about that follow-up is disclosed

### Requirement: A released reminder asks the lead to confirm or reschedule

A released reminder SHALL reach the lead as an interactive message offering
exactly two replies: one to confirm the appointment and one to ask to
reschedule it. It SHALL be delivered on the lead's existing conversation and
SHALL appear in that thread like any other outbound message, so an agent
reading the inbox sees what was sent.

#### Scenario: The reminder carries both replies

- **WHEN** a follow-up is released
- **THEN** the lead receives the reminder body with a confirm reply and a
  reschedule reply

#### Scenario: The reminder is visible in the thread

- **WHEN** a follow-up has been sent
- **THEN** an agent opening that lead's conversation sees the reminder in the
  thread with its send time

### Requirement: A lead's confirmation is recorded and flags the deal's remaining reminders

When a lead answers a reminder by confirming, the system SHALL record the
confirmation against the deal, together with the moment it arrived.

Every follow-up still pending for the same deal SHALL be flagged as belonging
to an already-confirmed appointment. Flagging SHALL NOT reject, expire, or
otherwise decide those follow-ups: they stay pending and a human still chooses
whether to send them. The pending list SHALL make the flag visible so the
reviewer can see the lead has already confirmed.

A confirmation SHALL NOT change the appointment time.

#### Scenario: Confirming stamps the deal

- **WHEN** a lead presses the confirm reply
- **THEN** the deal records the confirmation and the time it was received

#### Scenario: Remaining reminders are flagged, not cancelled

- **WHEN** a lead confirms after the first of three reminders was sent
- **THEN** the two later follow-ups are still pending, are shown as
  already-confirmed, and can still be approved or rejected by a person

#### Scenario: Confirming does not move the appointment

- **WHEN** a lead confirms
- **THEN** the appointment time is unchanged

#### Scenario: A repeated confirmation is harmless

- **WHEN** a lead presses confirm twice
- **THEN** the deal keeps a single confirmation and nothing else changes

### Requirement: A reschedule request reaches a human and changes no booking

When a lead answers a reminder by asking to reschedule, the system SHALL raise
a notification for the account so a person picks the conversation up, and SHALL
leave the appointment time, the deal's stage, and the deal's status exactly as
they were. The appointment time SHALL be changed only by a person editing the
deal.

#### Scenario: Reschedule notifies without rebooking

- **WHEN** a lead presses the reschedule reply
- **THEN** the account is notified, the conversation is surfaced for a human,
  and the appointment time is unchanged

#### Scenario: Reschedule does not decide the remaining reminders

- **WHEN** a lead asks to reschedule and later follow-ups are still pending for
  that deal
- **THEN** those follow-ups stay pending for a person to decide

### Requirement: A quiet lead can be answered with an AI-drafted follow-up

Any lead SHALL offer an action that drafts a follow-up message from that lead's
conversation history, written in the account's configured communication style
and subject to the same medical-advertising constraints as every other
generated message.

The action SHALL produce a draft for review and SHALL NOT send it. Sending
SHALL require the same explicit human release as any other follow-up, and the
member SHALL be able to edit the draft before sending. The action SHALL be
available whether or not the account has automatic replies switched on.

The member MAY choose one of the account's communication styles for this draft
alone; when they choose none, the account's default style applies. Choosing a
style for one draft SHALL NOT change the account's default.

A lead with no conversation history SHALL be told a draft cannot be produced
rather than be given invented content. A member with read-only permission SHALL
NOT be offered the action.

#### Scenario: A draft is produced for review

- **WHEN** an agent asks for an AI follow-up on a lead that went quiet
- **THEN** a draft written in the account's style is shown for review, and
  nothing has been sent

#### Scenario: Drafting never sends

- **WHEN** an agent generates a draft and navigates away without acting
- **THEN** the lead receives nothing

#### Scenario: The draft can be edited before it goes out

- **WHEN** an agent edits the generated text and sends
- **THEN** the lead receives the edited text

#### Scenario: A one-off style does not become the default

- **WHEN** an agent picks the direct style for one draft on an account whose
  default is friendly
- **THEN** that draft is written in the direct style and the next draft on the
  account is friendly again

#### Scenario: Automatic replies are irrelevant to the action

- **WHEN** an account has automatic replies switched off
- **THEN** the AI follow-up action is still available

#### Scenario: No history to draft from

- **WHEN** an agent asks for an AI follow-up on a lead with no messages
- **THEN** the agent is told a draft cannot be produced and no text is invented

#### Scenario: Read-only member

- **WHEN** a member with read-only permission opens a lead
- **THEN** the AI follow-up action is unavailable

### Requirement: The account can list the leads that went quiet

The account SHALL offer a reactivation list of its leads that have gone without
contact, alongside the pipeline board. Each entry SHALL identify the lead, how
long it has been since the last message on its conversation, and its pipeline
stage, and SHALL open that lead's conversation.

The list SHALL be filterable by days without contact, by pipeline stage, and by
whether the lead has a future appointment. Its default view SHALL use the
account's stale-lead threshold. The list SHALL carry a count of the entries it
currently matches.

The list SHALL be read-only with respect to the pipeline: opening or filtering
it SHALL NOT move a deal, change a stage, or contact anyone. No action on the
list SHALL send to more than one lead at a time.

#### Scenario: Default view uses the account threshold

- **WHEN** a member opens the reactivation list on an account whose threshold is
  15 days
- **THEN** the leads shown are those whose last message is at least 15 days old,
  and the count matches what is listed

#### Scenario: Filter by future appointment

- **WHEN** a member filters to leads without a future appointment
- **THEN** leads already booked ahead are excluded and the count updates

#### Scenario: Filter by stage

- **WHEN** a member filters to a single pipeline stage
- **THEN** only leads in that stage remain and the count updates

#### Scenario: Opening a lead from the list

- **WHEN** a member clicks an entry
- **THEN** that lead's conversation opens

#### Scenario: A lead that answered drops out

- **WHEN** a listed lead sends a message and the list is refreshed
- **THEN** the lead no longer appears under the days-without-contact filter

#### Scenario: There is no bulk send

- **WHEN** a member has the reactivation list open with many leads matched
- **THEN** no action offers to message the matched leads together
