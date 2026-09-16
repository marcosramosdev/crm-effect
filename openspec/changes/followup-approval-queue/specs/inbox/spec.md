## ADDED Requirements

### Requirement: An inbound button reply on a reminder is routed to the appointment it answers

A received interactive reply SHALL be recorded in the conversation exactly as
any other inbound message, whatever it turns out to answer.

When the reply answers an appointment reminder this account sent, the inbox
SHALL route it to that appointment — a confirm reply marks the appointment
confirmed, a reschedule reply raises a notification for a person — in addition
to recording the message. The routing SHALL be decided from the reply's
identity, not from its visible label, so a lead's own wording of the same
answer is never mistaken for a button press.

A reply that does not answer a reminder SHALL keep its current handling
unchanged. Appointment routing SHALL NOT consume the message: the existing
automation and flow dispatch for an interactive reply SHALL still run, and the
conversation's unread state and last-message preview SHALL be updated as they
are for any inbound message.

A redelivered reply SHALL take effect once. A reply that arrives for a reminder
belonging to a different account SHALL be ignored for routing purposes.

#### Scenario: Confirm reaches the appointment

- **WHEN** a lead presses the confirm button on a reminder
- **THEN** the message appears in the thread and the appointment is recorded as
  confirmed

#### Scenario: Reschedule surfaces for a human

- **WHEN** a lead presses the reschedule button on a reminder
- **THEN** the message appears in the thread, the account is notified, and the
  appointment time is unchanged

#### Scenario: Typed text is not a button press

- **WHEN** a lead types the word "Confirmar" as ordinary text instead of
  pressing the button
- **THEN** the message is recorded and handled as a normal inbound text, and no
  appointment is marked confirmed

#### Scenario: An unrelated button reply is unaffected

- **WHEN** a lead presses a button belonging to a flow or an automation
- **THEN** that reply is handled exactly as it is today

#### Scenario: Routing does not swallow the message

- **WHEN** a reminder reply arrives and the account also has automations that
  trigger on interactive replies
- **THEN** those automations still run and the conversation's unread count and
  last-message preview are updated

#### Scenario: The gateway redelivers the same reply

- **WHEN** the same button reply is delivered twice by the gateway
- **THEN** the thread shows one message and the appointment is confirmed once
