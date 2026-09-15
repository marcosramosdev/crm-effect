# Contacts Specification

## Purpose

Defines what an operator can do with a contact record from the contacts
surfaces — the contacts list and the contact detail view — rather than from the
inbox: creating a contact with account-scoped deduplication, and reaching a
WhatsApp conversation with that contact. Message transport lives in
`whatsapp-messaging`; the inbox's own start-a-conversation entry point and its
resolution rules live in `inbox`.

## Requirements

### Requirement: Create a contact from the contacts page

The contacts page SHALL offer an action to create a new contact. A phone number
SHALL be required; name, email, company, and tag assignments SHALL be optional.
Only a member with send permission SHALL be able to create a contact; a
read-only member SHALL see no create action.

Before the contact is created the phone number SHALL be checked against the
existing contacts of the same account. A number that exactly matches an
existing contact's SHALL block the create and offer to open that existing
contact. A number that is only a near match — a trunk-prefix or formatting
variant — SHALL warn but SHALL allow the operator to proceed. Account-wide
uniqueness of contact phone numbers SHALL be enforced on write regardless of
the pre-check outcome, and a create that loses that race SHALL be reported as a
duplicate rather than as a raw error.

A contact created this way SHALL be indistinguishable from one created by an
inbound message — same account tenancy and same deduplication.

On a successful create the operator SHALL be offered an immediate hand-off to
message the new contact, per "Reach a contact's WhatsApp conversation from the
contact record". Declining SHALL leave the new contact in the list with nothing
sent.

#### Scenario: Create with the minimum

- **WHEN** an operator with send permission enters only a valid phone number
  and confirms
- **THEN** the contact is created in the operator's account and appears in the
  contacts list

#### Scenario: Exact duplicate number is blocked

- **WHEN** an operator enters a phone number that exactly matches an existing
  contact in the account
- **THEN** the create is blocked and the operator is offered a way to open the
  existing contact instead

#### Scenario: Near-duplicate number warns but proceeds

- **WHEN** an operator enters a phone number that is a formatting or
  trunk-prefix variant of an existing contact's number
- **THEN** the operator is warned of the possible duplicate but can still
  choose to create the contact

#### Scenario: Offered to message the new contact

- **WHEN** a new contact is created successfully
- **THEN** the operator is offered an immediate hand-off to start a WhatsApp
  conversation with that contact, and declining it changes nothing further

#### Scenario: Read-only member

- **WHEN** a member without send permission opens the contacts page
- **THEN** no create-contact action is available

### Requirement: Reach a contact's WhatsApp conversation from the contact record

From the contact detail view and from the contacts list row menu, a member with
send permission SHALL be able to start a WhatsApp conversation with that
contact. The action SHALL open the start-a-conversation flow with the recipient
preset to that contact, offering the same two outcomes as the `inbox`
capability's "Start a new conversation from the app" — send a first message, or
open the thread without sending.

Resolving the contact to a conversation SHALL follow that same requirement's
rules: at most one conversation per account and contact, so a contact that
already has a thread SHALL have it opened rather than a second one created; the
configured default-pipeline seeding SHALL apply to a contact that gets its
first deal; and if a first message is sent and the send fails, no new
conversation SHALL be left behind and the failure SHALL be reported. In every
successful outcome the operator SHALL end up viewing that conversation in the
inbox, and it SHALL appear in the conversation list without a reload.

The contact detail view SHALL show a "view conversation" link that targets the
contact's conversation by its identifier whenever the contact has one, and SHALL
omit the link when the contact has no conversation. The "view conversation"
link MAY be shown to a read-only member.

When the account has no WhatsApp connection, the message action SHALL explain
that a connection must be set up first rather than accepting the request and
failing at send time. A member without send permission SHALL see neither the
message action nor the create hand-off.

#### Scenario: Message a contact who has no thread yet

- **WHEN** an operator with send permission triggers the message action on a
  contact that has no conversation and sends a first message
- **THEN** a conversation is created for that contact, the message is recorded
  as outbound in it, and the operator lands in that conversation in the inbox

#### Scenario: Message a contact who already has a thread

- **WHEN** an operator triggers the message action on a contact that already
  has a conversation
- **THEN** the existing conversation is opened — no second conversation is
  created — and the operator lands in it

#### Scenario: View-conversation link on a contact with a thread

- **WHEN** an operator opens the detail view of a contact that has a
  conversation
- **THEN** a "view conversation" link is shown that opens that conversation by
  its identifier

#### Scenario: No link when the contact has no thread

- **WHEN** an operator opens the detail view of a contact that has no
  conversation
- **THEN** no "view conversation" link is shown

#### Scenario: Failed first send leaves no residue

- **WHEN** the first message sent through the message action cannot be
  delivered
- **THEN** the operator is told why and no new conversation for that contact
  remains

#### Scenario: No WhatsApp connection

- **WHEN** an operator triggers the message action in an account with no
  WhatsApp connection
- **THEN** the action explains that a connection must be set up first and no
  send is attempted

#### Scenario: Read-only member

- **WHEN** a member without send permission views a contact record
- **THEN** no message action or create hand-off is offered, though a
  "view conversation" link MAY still be shown when the contact has a thread
