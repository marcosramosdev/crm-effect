# WhatsApp Messaging Specification

## Purpose

Defines how the CRM sends and receives WhatsApp messages over the unofficial
gateway: the outbound message types it supports, how inbound messages and
delivery-status updates become conversation records, and how media is moved in
both directions.

## Requirements

### Requirement: Supported outbound message types

The system SHALL support sending text, image, video, document, audio,
interactive menus (buttons and lists), and reactions. The system SHALL NOT
expose an approved-template message type.

#### Scenario: Send text

- **WHEN** a user sends a text message in a conversation
- **THEN** the message is delivered to the recipient, persisted as an outbound
  message with the gateway's message identifier, and the conversation's last
  activity is updated

#### Scenario: Send media with a caption

- **WHEN** a user sends an image, video, document, or audio with optional
  caption text
- **THEN** the file is delivered with the caption, and the persisted message
  records the media kind, caption, and stored file reference

#### Scenario: Send a document with a filename

- **WHEN** a document is sent with a filename
- **THEN** the recipient receives the document under that filename

#### Scenario: Reply to a specific message

- **WHEN** a send names a message in the same conversation to reply to
- **THEN** the outbound message is delivered as a quoted reply to that message

#### Scenario: Template type is rejected

- **WHEN** a caller requests a message of type `template`
- **THEN** the request is rejected with a validation error stating the type is
  no longer supported

#### Scenario: Unsupported message type

- **WHEN** a caller requests any message type outside the supported set
- **THEN** the request is rejected with a validation error before any gateway
  call is made

### Requirement: Composer voice recordings are sent as native voice messages

A voice message recorded in the composer (the mic / voice-note control)
SHALL be transmitted to the gateway as a native push-to-talk voice message,
so it renders in the recipient's WhatsApp as a voice bubble with a
waveform, not as a downloadable audio file. An audio _file_ chosen through
the attachment picker SHALL continue to be sent as an ordinary audio
attachment. The distinction SHALL be carried explicitly from the composer
through the send path; it SHALL NOT be inferred solely from the file's MIME
type or extension.

Both the dashboard send endpoint and the public send endpoint SHALL accept
the voice indicator. When the indicator is absent, an audio send behaves
exactly as before (ordinary audio attachment).

The persisted message SHALL record audio content type in both cases; the
stored file reference and any duration are unchanged.

#### Scenario: Send a recorded voice note

- **WHEN** an agent records a voice note in the composer and sends it
- **THEN** the recipient receives a native WhatsApp voice message, and the
  message is persisted as an outbound audio message with its stored file
  reference

#### Scenario: Send an uploaded audio file

- **WHEN** an agent attaches an audio file through the attachment picker and
  sends it
- **THEN** the recipient receives it as an ordinary audio attachment, not a
  voice bubble

#### Scenario: Voice indicator omitted

- **WHEN** an audio send is requested with no voice indicator
- **THEN** it is delivered as an ordinary audio attachment and no error is
  raised

### Requirement: No session window restriction

The system SHALL allow any supported message type to be sent at any time,
regardless of when the contact last replied.

#### Scenario: First contact with no prior inbound message

- **WHEN** a user sends a free-form text message to a contact who has never
  messaged the account
- **THEN** the message is sent normally, with no template requirement and no
  session-window error

### Requirement: Outbound media is transmitted inline

The system SHALL transmit outbound media to the gateway as inline base64 content
rather than as a pre-uploaded media handle, and SHALL reject files above a
configured size limit before contacting the gateway.

#### Scenario: Media under the limit

- **WHEN** a file within the configured size limit is sent
- **THEN** its bytes are transmitted inline with the declared MIME type and the
  send succeeds

#### Scenario: Media over the limit

- **WHEN** a file exceeding the configured size limit is sent
- **THEN** the send is rejected with an error naming the limit, no gateway call
  is made, and no outbound message row is persisted

#### Scenario: Unresolvable media reference

- **WHEN** the referenced file cannot be read
- **THEN** the send fails with an error identifying the media as the cause, and
  no partial message is persisted

### Requirement: Interactive menus

The system SHALL send button and list menus, each carrying a caller-defined
identifier per choice, and SHALL record the identifier reported when a contact
makes a selection.

#### Scenario: Send a button menu

- **WHEN** a user sends a menu with body text and up to the gateway's maximum
  number of buttons, each with a label and an identifier
- **THEN** the recipient receives tappable buttons and the persisted message
  records the menu structure

#### Scenario: Send a list menu

- **WHEN** a user sends a list with sections and rows, each row having a label
  and an identifier
- **THEN** the recipient receives the list and the persisted message records the
  menu structure

#### Scenario: Menu exceeds limits

- **WHEN** a menu exceeds the allowed number of choices, or a label exceeds the
  allowed length
- **THEN** the send is rejected with a validation error identifying the offending
  limit

#### Scenario: Contact selects a choice

- **WHEN** an inbound event reports that a contact selected a button or list row
- **THEN** the selection's identifier and label are persisted on the inbound
  message and made available to automations and flows as a reply payload

### Requirement: Reactions

The system SHALL send emoji reactions to a specific message and SHALL record
inbound reactions against the message they target.

#### Scenario: Send a reaction

- **WHEN** a user reacts to a message with an emoji
- **THEN** the reaction is delivered to the recipient and recorded against the
  target message

#### Scenario: Remove a reaction

- **WHEN** a user clears their reaction on a message
- **THEN** the removal is delivered and the recorded reaction is cleared

#### Scenario: Inbound reaction

- **WHEN** an inbound event reports a reaction to one of the account's messages
- **THEN** the reaction is recorded against that message

### Requirement: Inbound message ingestion

The system SHALL accept gateway message events at the callback endpoint,
resolve or create the contact and conversation for the sender, persist the
message, and dispatch it to automations, flows, AI auto-reply, and outbound
webhook subscribers. Ingestion SHALL NOT depend on a single exact spelling of
the gateway's event-type field: the system SHALL treat the gateway's inbound
message event and its delivery-status update event as ingestible under any of
the spellings the gateway is known to use for them. When the callback receives
a well-formed event envelope whose event type the system does not act on, it
SHALL acknowledge the request and record the received event type and instance
identifier in logs, so that a gateway sending an unexpected event name is
diagnosable rather than silently ignored.

#### Scenario: Inbound text from a known contact

- **WHEN** a message event arrives from a phone number matching an existing
  contact
- **THEN** the message is persisted on that contact's conversation, the
  conversation is marked unread and reopened if it was closed, and downstream
  dispatch runs

#### Scenario: Inbound text from an unknown number

- **WHEN** a message event arrives from a number with no matching contact
- **THEN** a contact is created from the number and the sender's display name, a
  conversation is opened, and the message is persisted against it

#### Scenario: Inbound event under an alternate event-type name

- **WHEN** an inbound message event arrives whose event-type field uses a
  different but known gateway spelling than another otherwise identical event
- **THEN** it is ingested exactly as it would be under the primary spelling —
  the contact and conversation are resolved, the message is persisted, and
  downstream dispatch runs

#### Scenario: Duplicate event delivery

- **WHEN** the same gateway message identifier is delivered more than once
- **THEN** exactly one message row exists for it and downstream dispatch runs at
  most once

#### Scenario: Group and channel messages are ignored

- **WHEN** an inbound event is for a group chat or a channel
- **THEN** it is acknowledged and discarded without creating a contact,
  conversation, or message

#### Scenario: Echo of an outbound message

- **WHEN** an inbound event describes a message the system itself sent
- **THEN** it is acknowledged without creating a duplicate outbound message row

#### Scenario: Recognized envelope with an unhandled event type

- **WHEN** the callback receives a well-formed event envelope whose event type
  the system takes no action on
- **THEN** the request is acknowledged, the received event type and instance
  identifier are logged, and nothing is persisted

#### Scenario: Malformed event body

- **WHEN** the callback receives a body that is not a recognized event envelope
- **THEN** the request is acknowledged without error to prevent redelivery
  storms, and nothing is persisted

### Requirement: New inbound contacts join the configured default pipeline

An account MAY designate a default pipeline and stage for contacts created
from inbound WhatsApp messages. When such a default is configured and the
inbound webhook creates a new contact while ingesting a message, the system
SHALL create one deal for that contact on the configured pipeline and
stage. When no default is configured, no deal is created and ingestion is
unchanged.

The seeding SHALL apply only to contacts the webhook itself creates during
ingestion — a contact that already existed, or a newly created contact that
already has a deal, SHALL NOT get an additional deal. Deal creation SHALL be
best-effort: a failure to create the deal SHALL be logged and SHALL NOT
fail message ingestion or block downstream dispatch.

If the configured pipeline or stage has been deleted, the setting SHALL be
treated as unset and no deal SHALL be created.

#### Scenario: New contact with a default pipeline configured

- **WHEN** an inbound message arrives from a number with no matching contact
  and the account has a default inbound pipeline and stage configured
- **THEN** the contact and conversation are created as normal, the message is
  persisted, and one deal for the new contact is created on the configured
  pipeline at the configured stage

#### Scenario: No default configured

- **WHEN** an inbound message creates a new contact and the account has no
  default inbound pipeline configured
- **THEN** the contact, conversation, and message are created as before and no
  deal is created

#### Scenario: Existing contact messages again

- **WHEN** an inbound message arrives from a number that already matches a
  contact
- **THEN** no new deal is created, regardless of the default-pipeline setting

#### Scenario: Deal creation fails

- **WHEN** the default pipeline is configured but the deal insert fails
- **THEN** the failure is logged, the inbound message is still persisted, and
  automations, flows, AI auto-reply, and webhook dispatch still run

#### Scenario: Configured pipeline was deleted

- **WHEN** a new contact is created and the account's configured default
  pipeline or stage no longer exists
- **THEN** no deal is created and ingestion completes without error

### Requirement: Ingested inbound messages surface in the inbox without a reload

The system SHALL surface a newly ingested inbound message in an inbox view that
is already open, without the viewer reloading the page or pressing a manual
refresh, for any signed-in user authorized to see that conversation. Live
delivery MAY be best-effort: when the live update channel is unavailable, the
message SHALL still be present on the next manual refresh or page load, with no
data lost.

#### Scenario: New message on the conversation being viewed

- **WHEN** an inbound message is ingested for the conversation currently open in
  a user's inbox
- **THEN** the message appears in the open thread and the conversation's preview
  and ordering update, within a few seconds, without a reload

#### Scenario: New message on a conversation not currently open

- **WHEN** an inbound message is ingested for a conversation that exists in the
  user's list but is not the open one
- **THEN** that conversation's preview text and unread indicator update in the
  list without a reload

#### Scenario: Inbound message that starts a new conversation

- **WHEN** an inbound message is ingested that creates a new contact and
  conversation
- **THEN** the new conversation appears in the open inbox's list without a
  reload

#### Scenario: Live channel unavailable

- **WHEN** the inbox's live update channel is disconnected at the time a message
  is ingested
- **THEN** no message is lost — the message is shown once the user refreshes or
  the channel reconnects and the view resynchronizes

### Requirement: Inbound media is downloaded and mirrored

The system SHALL fetch the file for an inbound media message from the gateway
and store a copy in the account's own media storage, so the message remains
viewable after the gateway's retention period ends.

#### Scenario: Inbound image

- **WHEN** an inbound message carries an image
- **THEN** the file is downloaded, stored in the account's media storage, and the
  persisted message references the stored copy

#### Scenario: Inbound voice note

- **WHEN** an inbound message carries a voice note
- **THEN** the audio is downloaded, stored, and the persisted message references
  the stored copy and its duration where reported

#### Scenario: Download failure

- **WHEN** the media download fails
- **THEN** the text portion of the message is still persisted, the media is
  marked as unavailable, and the failure is logged without failing the callback

#### Scenario: Storage is unavailable

- **WHEN** the account's media storage rejects the upload
- **THEN** the message is persisted referencing the gateway-provided file URL as
  a fallback, and the failure is logged

### Requirement: Inbound content-type classification tolerates gateway spelling variants

Classifying an inbound message's content SHALL NOT depend on a single exact
spelling of the gateway's per-message type field. The system SHALL map every
spelling the gateway is known to use for a media or location message —
including the bare form (`image`, `audio`, `ptt`, `video`, `document`,
`sticker`, `location`) and the proto-style suffixed form (`ImageMessage`,
`AudioMessage`, `PttMessage`, `VideoMessage`, `DocumentMessage`,
`StickerMessage`, `LocationMessage`), case-insensitively — onto the correct
stored `content_type`. For a recognised media message the file SHALL be
downloaded and mirrored per "Inbound media is downloaded and mirrored", and
the persisted message SHALL carry that media kind and its stored file
reference, not a text placeholder. A message type the system genuinely does
not recognise SHALL still be persisted (as text, with a diagnostic
placeholder body) and the received type SHALL be logged.

#### Scenario: Inbound image under the suffixed type spelling

- **WHEN** an inbound message arrives whose gateway type field reads
  `ImageMessage` (or any case variant) and carries an image
- **THEN** it is stored with image content type, its file is downloaded and
  mirrored, and it renders in the inbox as an image bubble — never as text
  reading that the type is unsupported

#### Scenario: Inbound voice note under the suffixed type spelling

- **WHEN** an inbound message arrives whose gateway type field reads
  `AudioMessage` or `PttMessage` and carries a voice recording
- **THEN** it is stored with audio content type, its file is downloaded and
  mirrored, and it renders in the inbox as a playable voice note

#### Scenario: Inbound video, document, and sticker under the suffixed spelling

- **WHEN** an inbound message arrives typed `VideoMessage`, `DocumentMessage`,
  or `StickerMessage`
- **THEN** it is classified as video, document, and image respectively, its
  file is downloaded and mirrored, and it renders as the matching media
  bubble

#### Scenario: Inbound location under the suffixed type spelling

- **WHEN** an inbound message arrives typed `LocationMessage`
- **THEN** it is stored with location content type and renders as a shared
  location, not as unsupported text

#### Scenario: Media message whose file cannot be resolved

- **WHEN** a message is recognised as a media kind by its type spelling but
  the media download fails
- **THEN** the message is still persisted with the correct media content
  type, the media is marked unavailable, and the inbox shows the
  "unavailable" affordance for that kind rather than a raw placeholder string

#### Scenario: Genuinely unknown message type

- **WHEN** an inbound message arrives with a type the system maps to no known
  media, location, or text kind
- **THEN** the message is persisted as text with a placeholder body naming the
  received type, and the received type is recorded in logs

### Requirement: Delivery-status updates

The system SHALL apply gateway message-update events to the corresponding
outbound message, tracking at least sent, delivered, read, and failed states,
and SHALL record the reported error text on failure.

#### Scenario: Delivered then read

- **WHEN** update events report a message delivered and later read
- **THEN** the message's status advances to delivered and then to read, and the
  timestamps are recorded

#### Scenario: Send failure reported asynchronously

- **WHEN** an update event reports a message failed
- **THEN** the message is marked failed and the reported error text is stored and
  shown in the inbox

#### Scenario: Status regression is ignored

- **WHEN** an update event reports a status earlier in the lifecycle than the
  status already recorded
- **THEN** the recorded status is left unchanged

#### Scenario: Update for an unknown message

- **WHEN** an update event names a message identifier that is not stored
- **THEN** the event is acknowledged and discarded without creating a message row

### Requirement: Send failures are surfaced with cause

The system SHALL translate gateway failures into errors that distinguish an
unauthenticated or disconnected instance, a rate limit, an invalid recipient, and
an unexpected gateway fault.

#### Scenario: Rate limited

- **WHEN** the gateway reports a rate limit
- **THEN** the send fails with a rate-limit error that callers can retry, and no
  message row is persisted as sent

#### Scenario: Recipient not on WhatsApp

- **WHEN** the gateway reports the recipient number is not reachable on WhatsApp
- **THEN** the send fails with an error identifying the recipient as the cause,
  and the message is recorded as failed with that reason

### Requirement: Dashboard sends can target a phone number

The dashboard's outbound-send endpoint SHALL accept a recipient identified by
phone number, in addition to the existing conversation and contact targets.
Exactly one target SHALL be supplied; a request naming more than one, or none,
SHALL be rejected as a bad request without sending anything.

Given a phone-number target, the system SHALL resolve it to a contact and a
conversation using the same rules the public messaging API already applies:
international-format validation, account-scoped contact deduplication so an
existing contact is matched rather than duplicated, and one conversation per
account and contact. A resolved recipient SHALL be indistinguishable from one
created by an inbound message or by the public API.

Resolution SHALL be ordered so that a failed send leaves no residue: if the
send to the gateway fails, no contact and no conversation created for this
request SHALL persist. A send targeting a number that already had a contact or
conversation SHALL leave those pre-existing records intact regardless of the
send's outcome.

The endpoint SHALL keep its existing authorization and rate-limit behaviour for
this target: the caller SHALL hold send permission, and the request SHALL count
against the same per-user send budget as any other send.

#### Scenario: Send to an unknown number

- **WHEN** a caller with send permission posts a text message targeting a phone
  number that matches no contact in the account
- **THEN** a contact and conversation are created for that number, the message is
  delivered, and it is persisted as an outbound message in that conversation

#### Scenario: Send to a number with an existing contact

- **WHEN** a caller targets a phone number that already belongs to a contact
- **THEN** the message is sent in that contact's existing conversation, and no
  duplicate contact or conversation is created

#### Scenario: Gateway failure leaves no residue

- **WHEN** a send targeting a previously unknown phone number fails at the
  gateway
- **THEN** the failure is reported with its cause, and no contact and no
  conversation for that number remain

#### Scenario: Malformed number

- **WHEN** a caller targets a value that is not a valid international phone
  number
- **THEN** the request is rejected as a bad request and no gateway call, contact,
  or conversation is made

#### Scenario: Conflicting targets

- **WHEN** a caller supplies both a phone-number target and a conversation
  target in the same request
- **THEN** the request is rejected as a bad request and nothing is sent

#### Scenario: Caller lacks send permission

- **WHEN** a caller without send permission targets a phone number
- **THEN** the request is rejected on authorization, and no contact,
  conversation, or gateway call is made

### Requirement: Inbound ad attribution is captured on the contact

When an inbound message carries the gateway's ad-referral block — the payload
Meta attaches to the first message of a conversation started from a Click-to-
WhatsApp ad — the system SHALL persist the click identifier, the ad source
identifier, and the time the identifier was captured, on the contact that sent
the message.

The most recent click SHALL win: a later ad click overwrites the stored
attribution, so a conversion is credited to the click that produced it rather
than to a click from a previous campaign.

Capture SHALL be best-effort with respect to ingestion: a failure to store the
attribution SHALL NOT prevent the message from being ingested, and SHALL be
logged.

#### Scenario: First message from an ad

- **WHEN** an inbound message arrives carrying an ad-referral block with a click
  identifier and an ad source identifier
- **THEN** the contact record holds that click identifier, that ad source
  identifier, and the capture time

#### Scenario: Later messages in the same conversation

- **WHEN** the same contact sends further messages, which carry no ad-referral
  block
- **THEN** the stored attribution is left unchanged

#### Scenario: A second ad click overwrites the first

- **WHEN** a contact who already has stored attribution starts a new conversation
  from a different ad
- **THEN** the contact's attribution is replaced with the newer click identifier,
  ad source identifier, and capture time

#### Scenario: Organic conversation

- **WHEN** an inbound message arrives with no ad-referral block and the contact
  has no stored attribution
- **THEN** the attribution fields stay empty and the message is ingested normally

#### Scenario: Attribution storage fails

- **WHEN** persisting the attribution fails
- **THEN** the message is still ingested and the failure is logged
