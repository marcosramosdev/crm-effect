# Inbox Specification

## Purpose

Defines agent-facing inbox behaviour that is not message transport: what
affordances the message composer offers for sending, how received message
bubbles present each content type, and the inline CRM actions an agent can
take on a conversation without leaving the inbox — specifically moving the
contact's deal between pipeline stages.

## Requirements

### Requirement: Dedicated voice-message button in the composer

The composer SHALL present a voice-message control that is visible at all
times alongside the send control, not only inside the attachment menu.
Activating it SHALL begin a voice recording using the same in-browser
recorder and recording UI already used for attachment-menu voice notes,
including the elapsed/maximum timer, cancel, and stop-and-attach controls,
and the same maximum-duration auto-stop. The send control SHALL remain
independently available for text. The voice-message entry in the attachment
menu MAY remain.

#### Scenario: Start a voice note from the always-visible button

- **WHEN** an agent with send permission clicks the voice-message button next
  to Send
- **THEN** recording starts immediately and the composer switches to the
  recording bar with a running timer and cancel / stop controls

#### Scenario: Stop and review before sending

- **WHEN** the agent stops a recording
- **THEN** the encoded audio is staged as a pending attachment with a player
  preview and is only delivered when the agent confirms the send

#### Scenario: Read-only member

- **WHEN** a user without send permission views the composer
- **THEN** the voice-message button is disabled with the same read-only
  affordance as the other send controls

### Requirement: Received messages render by content type

A received message SHALL render according to its stored content type. An
image, video, document, or audio message with a resolvable file SHALL render
as the corresponding media element (an image preview, a video player, a
document row, or an audio player). An audio message SHALL render a usable
inline player for both inbound and outbound directions. A media message
whose file is unavailable SHALL render the "unavailable" affordance for that
media kind. A message classified as a known media or location kind SHALL NOT
render as literal text stating that the message type is unsupported.

#### Scenario: Inbound voice note

- **WHEN** a received message has audio content type and a resolvable file
- **THEN** the bubble shows an inline audio player the agent can play without
  leaving the inbox

#### Scenario: Inbound image

- **WHEN** a received message has image content type and a resolvable file
- **THEN** the bubble shows the image preview, opening the media viewer when
  clicked

#### Scenario: Media file unavailable

- **WHEN** a received media message has no resolvable file
- **THEN** the bubble shows the media-kind "unavailable" placeholder, not a
  raw diagnostic string

### Requirement: Change a contact's pipeline stage from the inbox

From an open conversation, an agent who is not a read-only member SHALL be
able to move the contact's deal between stages of its pipeline AND move it
to a different pipeline entirely, without navigating to the pipelines view.
The control SHALL be available in the contact sidebar's deals section and
as a compact control on the conversation's row in the conversation list,
acting on the contact's primary deal.

Moving to a different pipeline SHALL let the agent choose the landing stage
in the target pipeline. The move SHALL reassign the existing deal — its
title, value, currency, notes, assignee, status, and creation history are
preserved; only the pipeline and stage change. A contact SHALL still have
at most one primary deal at a time; moving a deal never creates a second
one.

When the contact has no deal, the sidebar SHALL offer an action to add the
contact to a pipeline at a chosen stage. Stage and pipeline changes SHALL
update the view optimistically and persist the deal's new pipeline/stage; a
failed persist SHALL revert the view and surface an error.

The compact conversation-list control MAY offer stage changes only; pipeline
transfer MAY be limited to the contact sidebar.

#### Scenario: Move a deal to another stage from the contact sidebar

- **WHEN** an agent picks a different stage for a deal in the contact
  sidebar's deals card
- **THEN** the deal's stage badge updates immediately and the deal's stage is
  persisted; on failure the badge reverts and an error is shown

#### Scenario: Move a deal to another pipeline from the contact sidebar

- **WHEN** an agent picks a different pipeline for the contact's primary
  deal and selects a stage in that pipeline
- **THEN** the same deal is reassigned to the chosen pipeline and stage, the
  sidebar reflects the new pipeline/stage immediately, and the change is
  persisted; on failure the view reverts and an error is shown

#### Scenario: Deal identity is preserved across a pipeline move

- **WHEN** a deal with a value, notes, and an assignee is moved to another
  pipeline
- **THEN** the deal keeps the same identifier and all of those fields, and it
  no longer appears on the source pipeline's board and does appear on the
  target pipeline's board at the chosen stage

#### Scenario: Move a deal from the conversation list row

- **WHEN** an agent changes the stage from the compact control on a
  conversation-list row
- **THEN** the contact's primary deal moves to that stage and the change
  persists, consistent with moving the same deal on the pipeline board

#### Scenario: Contact has no deal yet

- **WHEN** an agent opens the deals card for a contact with no deal
- **THEN** an "add to pipeline" action is offered that creates a deal for the
  contact at a chosen pipeline and stage

#### Scenario: Read-only member

- **WHEN** a read-only member views the conversation
- **THEN** the stage and pipeline controls are read-only, showing the current
  pipeline and stage without an editable picker

### Requirement: Start a new conversation from the app

An agent with send permission SHALL be able to open a conversation with a
recipient who has not messaged in first, without leaving the app. The entry
point SHALL be available from the inbox and SHALL name the recipient in one of
two ways: by selecting an existing contact, or by entering a phone number
directly.

The system SHALL accept a phone number in international format and SHALL reject
one it cannot interpret, telling the agent the number is invalid before any
contact or conversation is created. An entered number that already belongs to a
contact in the account SHALL resolve to that contact and to that contact's
existing conversation — it SHALL NOT create a second contact or a second thread
for the same number.

The flow SHALL offer both outcomes:

- **Send a first message.** The agent writes a message and sends it. The
  contact and the conversation SHALL be created only if the send succeeds; a
  failed send SHALL leave no new contact and no new conversation behind, and
  SHALL report why it failed.
- **Open the thread without sending.** The contact and the conversation SHALL be
  created immediately and the agent SHALL be taken to that conversation's
  composer.

In both outcomes the agent SHALL end up viewing the resulting conversation, and
the conversation SHALL appear in the conversation list without requiring a
reload.

A contact created this way SHALL be indistinguishable from one created by an
inbound message — same account tenancy, same deduplication, and subject to the
same configured default-pipeline seeding.

When the account has no WhatsApp connection, the entry point SHALL explain that
a connection is required instead of failing at send time.

#### Scenario: Message a brand-new number

- **WHEN** an agent enters a phone number that matches no existing contact,
  writes a first message, and sends
- **THEN** a contact and a conversation are created for that number, the message
  is delivered and recorded as outbound in that thread, and the agent lands in
  the conversation

#### Scenario: Failed send creates nothing

- **WHEN** the first message to a new number cannot be delivered
- **THEN** the agent is told why, and no contact and no conversation for that
  number exist afterwards

#### Scenario: Number already belongs to a contact

- **WHEN** an agent enters a phone number that already belongs to a contact in
  the account
- **THEN** the flow resolves to that existing contact and its existing
  conversation, and no duplicate contact or thread is created

#### Scenario: Start from a saved contact

- **WHEN** an agent selects an existing contact that has never had a
  conversation and chooses to open the thread
- **THEN** a conversation is created for that contact and the agent lands in its
  composer with nothing sent

#### Scenario: Open a thread without sending

- **WHEN** an agent enters a new number and chooses to open the thread rather
  than send
- **THEN** the contact and conversation are created, the agent lands in the
  composer, and the conversation appears in the conversation list with no
  messages

#### Scenario: Invalid number

- **WHEN** an agent enters a value that is not a usable phone number
- **THEN** the agent is told the number is invalid, and no contact, conversation,
  or send is attempted

#### Scenario: No WhatsApp connection

- **WHEN** an agent opens the flow in an account with no WhatsApp connection
- **THEN** the flow explains that a connection must be set up first, rather than
  accepting a recipient and failing later

#### Scenario: Read-only member

- **WHEN** a user without send permission views the inbox
- **THEN** the start-a-conversation entry point is unavailable or disabled with
  the same read-only affordance as the other send controls

### Requirement: Open the full deal editor from the inbox

From an open conversation, an agent SHALL be able to open the contact's deal in
the same full deal detail view used on the pipeline board — including its
built-in attributes, custom field values, and note history — without navigating
to the pipelines view. The entry point SHALL be in the contact sidebar's deals
section, alongside the existing stage and pipeline controls, which SHALL remain
available for quick moves.

Changes saved through the detail view SHALL be reflected in the inbox's view of
the deal without requiring a reload. A member without send permission SHALL be
able to open the detail view read-only.

#### Scenario: Edit a deal without leaving the inbox

- **WHEN** an agent opens the deal detail view from the inbox contact sidebar,
  changes the deal's value and a custom field, and saves
- **THEN** the changes are persisted and the sidebar reflects the updated deal
  without a reload

#### Scenario: Quick controls remain

- **WHEN** an agent views the deals section in the contact sidebar
- **THEN** the stage and pipeline pickers are still available for a direct move,
  in addition to the entry point into the full detail view

#### Scenario: Read-only member

- **WHEN** a read-only member opens the deal detail view from the inbox
- **THEN** the deal's attributes, custom field values, and notes are readable and
  none of them can be edited
