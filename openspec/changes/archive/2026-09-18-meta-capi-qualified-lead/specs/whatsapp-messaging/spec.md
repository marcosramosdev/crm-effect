## ADDED Requirements

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
