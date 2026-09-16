# WhatsApp Connection Specification

## Purpose

Governs how an account links a WhatsApp number to the CRM through an unofficial
WhatsApp gateway instance: provisioning the instance, logging in by QR or
pairing code, observing and recovering connection state, registering the
callback that delivers events, and protecting the credentials involved.

## Requirements

### Requirement: Account-scoped instance provisioning

The system SHALL provision exactly one gateway instance per account and store
its identifier and instance token. Provisioning SHALL use an operator-supplied
server admin credential that is never exposed to the browser or to any
non-owner role.

Provisioning MAY happen ahead of the client's first visit to the connection
screen, as part of creating the account. When an instance already exists, the
connection screen SHALL go straight to login — the client's first action is
scanning the code, not asking for an instance.

#### Scenario: First connection provisions an instance

- **WHEN** an account with no WhatsApp configuration starts the connection flow
- **THEN** the system creates a gateway instance for that account, stores the
  returned instance identifier and instance token, and reports the connection as
  awaiting login

#### Scenario: Second connection reuses the existing instance

- **WHEN** an account that already has a stored instance starts the connection
  flow again
- **THEN** the system reuses the stored instance instead of creating a new one

#### Scenario: Pre-provisioned account goes straight to login

- **WHEN** the client of an account whose instance was created during account
  provisioning opens the connection screen for the first time
- **THEN** a login code is offered without creating a second instance

#### Scenario: Admin credential is not configured

- **WHEN** the server admin credential is absent from the environment and a user
  starts the connection flow
- **THEN** the request fails with an explanatory error naming the missing
  configuration, and no partial configuration row is persisted

#### Scenario: Admin credential never leaves the server

- **WHEN** any client-facing response describing the WhatsApp configuration is
  produced
- **THEN** it contains neither the server admin credential nor the raw instance
  token

### Requirement: Login by QR code or pairing code

The system SHALL let a user complete WhatsApp login either by scanning a QR code
or by entering a pairing code on a phone whose number they supply.

#### Scenario: QR login

- **WHEN** a user starts login without supplying a phone number
- **THEN** the system displays a QR code returned by the gateway and refreshes it
  before it expires until the instance reports a connected state

#### Scenario: Pairing-code login

- **WHEN** a user starts login and supplies a phone number in international
  format
- **THEN** the system displays the pairing code returned by the gateway and
  continues to poll until the instance reports a connected state

#### Scenario: Login times out

- **WHEN** the login attempt expires without the instance reaching a connected
  state
- **THEN** the system reports the timeout and offers to restart login, leaving
  the stored instance intact

#### Scenario: Invalid phone number for pairing

- **WHEN** a user supplies a phone number that is not valid international format
- **THEN** the system rejects the request before contacting the gateway and
  explains the expected format

### Requirement: Connection state is observable and persisted

The system SHALL persist the instance's connection state — one of
`disconnected`, `connecting`, `connected`, or `hibernated` — together with the
paired WhatsApp phone number once known. The system SHALL surface that state in
two places:

1. A **dedicated connection page** reachable from a primary-navigation entry
   labelled **`WhatsApp`**, which shows the current state and — for an owner or
   admin — the actions to connect or disconnect.
2. An **always-visible status cue** in the application chrome, present on every
   authenticated screen, that reflects the persisted state on first render
   without the operator opening the connection page and updates as the stored
   state changes. On screens where the primary-navigation sidebar is visible,
   this cue SHALL be carried by the `WhatsApp` navigation entry itself — its
   icon and label rendered in the tone below. Where the sidebar is not visible
   (the mobile header), a matching indicator SHALL carry the same cue. The app
   logo SHALL NOT be used to carry connection state.

The always-visible status cue SHALL distinguish three operator-facing
conditions, each with a visually distinct cue:

- **never connected** (neutral / grey cue) — no instance has been provisioned
  and no WhatsApp number has ever been paired;
- **online** (positive / green cue) — the stored state is `connected`;
- **connection lost** (alert / red cue) — an instance exists or a number was
  previously paired, but the stored state is not `connected`.

Colour SHALL NOT be the only cue: each surface SHALL also carry the status in
words via an accessible name or title.

The distinction between "never connected" and "connection lost" SHALL be
derived from whether an instance or paired number exists; it does not require a
new persisted field.

#### Scenario: Successful pairing records the number

- **WHEN** the instance transitions to `connected`
- **THEN** the system stores the state, the paired phone number, and the time of
  connection, the connection page shows the number as connected, and the
  `WhatsApp` navigation entry shows the **online** (green) cue

#### Scenario: Gateway reports a disconnection

- **WHEN** a connection event reports that the instance left the connected state
  for an account that had previously paired a number
- **THEN** the system updates the stored state, the connection page shows the
  number as no longer connected with an action to reconnect, and the `WhatsApp`
  navigation entry shows the **connection lost** (red) cue

#### Scenario: Account that has never connected

- **WHEN** an authenticated screen renders for an account with no provisioned
  instance and no paired number
- **THEN** the `WhatsApp` navigation entry shows the **never connected** (grey)
  cue and the connection page invites the operator to connect

#### Scenario: Status is visible away from the connection page

- **WHEN** the operator is on any authenticated screen other than the
  connection page
- **THEN** the `WhatsApp` navigation entry (or, on the mobile header, the
  matching indicator) still reflects the current persisted connection state,
  and the app logo carries no connection-state styling

#### Scenario: Sending while not connected

- **WHEN** an outbound send is attempted while the stored state is not
  `connected`
- **THEN** the send fails with an error that identifies the disconnected state
  rather than a generic gateway error

### Requirement: Operator-facing connection UI does not disclose the gateway

The operator-facing connection surfaces — the dedicated connection page, the
always-visible status cue, the primary-navigation entry, and their copy — SHALL
NOT describe the WhatsApp link as "unofficial", SHALL NOT name the third-party
gateway provider, and SHALL NOT surface gateway-internal concepts (instance
tokens, webhook secrets, provider admin credentials) to the operator. Labelling
the primary-navigation entry `WhatsApp` is permitted: it names the messaging
platform the operator is connecting, not the gateway provider. This constrains
only what the operator UI presents; the credential-protection,
webhook-registration, and instance-provisioning requirements are unchanged and
continue to apply on the server.

#### Scenario: Connection page hides the gateway's nature

- **WHEN** an operator opens the connection page or views the status cue
- **THEN** no visible text describes the connection as unofficial, names the
  gateway provider, or exposes an instance token or webhook secret

#### Scenario: Navigation entry names the platform, not the gateway

- **WHEN** an operator views the primary-navigation entry for the connection
  page
- **THEN** it reads `WhatsApp` and carries no reference to the third-party
  gateway provider

#### Scenario: Reconnect guidance stays provider-neutral

- **WHEN** the connection is lost and the UI prompts the operator to reconnect
- **THEN** the guidance refers to scanning a QR code or entering a pairing code
  without naming the underlying gateway

### Requirement: Disconnect

The system SHALL let an account owner or admin disconnect the instance.
Disconnecting SHALL delete the account's gateway instance and clear every stored
credential and pairing detail for it — the instance identifier, the instance
token, the connection state, the paired phone number, and the pairing time — so
that after a disconnect the account is in the same unconfigured state a
never-connected account starts from and the next login provisions a fresh
instance. The delete SHALL be scoped to the account's own instance and MUST NOT
be able to affect any other account's instance. Disconnecting SHALL always clear
the paired phone number, so that the next login may pair any WhatsApp number —
there is no separate action to keep a number reconnectable versus freeing it up
for a different one. Disconnecting SHALL succeed and clear local state even when
the gateway rejects, cannot be reached, or reports the instance as already gone,
since the operator's goal — no longer being paired — is already satisfied
locally regardless of what the gateway reports.

#### Scenario: Disconnect clears the paired number

- **WHEN** an authorized user disconnects
- **THEN** the account's gateway instance is deleted, the stored instance
  identifier and instance token are cleared, the stored state becomes
  `disconnected`, the paired phone number and pairing time are cleared, the
  account reads as unconfigured, and the next login provisions a new instance
  rather than reusing the deleted one

#### Scenario: Disconnect succeeds despite a gateway failure

- **WHEN** an authorized user disconnects and the gateway rejects the stored
  instance credential, cannot be reached, or reports that the instance no longer
  exists
- **THEN** the stored instance identifier, instance token, paired number, and
  pairing time are still cleared and the stored state still becomes
  `disconnected`, and the failure is logged rather than surfaced as an error

#### Scenario: Disconnect only affects the account's own instance

- **WHEN** an authorized user disconnects
- **THEN** the gateway delete is authenticated with that account's own instance
  credential, so only that account's instance is removed and instances belonging
  to other accounts are untouched

#### Scenario: Insufficient role

- **WHEN** a user whose role is agent or viewer attempts to disconnect
- **THEN** the request is refused with an authorization error and no state
  changes

### Requirement: Webhook registration

Because the gateway does not sign its callbacks, the system SHALL authenticate
inbound events by an unguessable secret that is generated per account, stored,
and embedded in the callback URL registered with the gateway. The system SHALL
register the callback to receive message, message-update, and connection events,
and SHALL exclude events for messages the system itself sent. Webhook
registration and the secret it carries are managed entirely by the system;
there is no user-facing action to trigger, view, or rotate them.

#### Scenario: Callback registered on connect

- **WHEN** an instance is provisioned or reconnected
- **THEN** the system generates or reuses the account's callback secret and
  registers a callback URL containing it, subscribed to message,
  message-update, and connection events

#### Scenario: Self-sent messages are excluded

- **WHEN** the callback is registered
- **THEN** the registration excludes messages originated by the API, so
  outbound sends do not re-enter the system as inbound events

#### Scenario: Callback with a wrong or missing secret

- **WHEN** a request arrives at the callback endpoint whose secret does not
  match any account's stored secret
- **THEN** the request is rejected as unauthorized and no data is written

### Requirement: Credential protection at rest

The system SHALL store the instance token and the callback secret encrypted at
rest under the deployment's encryption key, and SHALL never return either value
in an API response.

#### Scenario: Stored token is encrypted

- **WHEN** an instance token is persisted
- **THEN** the stored value is ciphertext, decryptable only with the
  deployment's encryption key

#### Scenario: Configuration read redacts secrets

- **WHEN** a user reads the WhatsApp configuration
- **THEN** the response reports connection state, paired number, and instance
  identifier, but omits the instance token and callback secret
