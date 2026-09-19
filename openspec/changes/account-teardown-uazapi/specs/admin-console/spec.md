## RENAMED Requirements

- FROM: `### Requirement: An account can be taken out of service without losing anything`
- TO: `### Requirement: An account can be taken out of service, keeping its data but not its connection`

## MODIFIED Requirements

### Requirement: An account can be taken out of service, keeping its data but not its connection

The console SHALL let a platform operator deactivate an account and reactivate
a deactivated one. Deactivation SHALL be reversible: the account's contacts,
deals, conversations, messages, history and configuration SHALL survive it
unchanged, and reactivation SHALL restore the client's access to all of them
exactly as they were.

Deactivation SHALL delete the account's WhatsApp connection, which does not
survive it. Reactivation SHALL return the account with WhatsApp disconnected
and no paired number, and the client SHALL have to pair a number again to send
or receive messages. Reactivation SHALL NOT re-establish the connection on the
client's behalf.

Because deactivation cuts the client off from the product and costs them their
WhatsApp pairing, the console SHALL ask the operator to confirm before applying
it, naming the account. The confirmation SHALL state, in plain words and before
the operator confirms, that the WhatsApp connection will be deleted and that
reconnecting will require the client to pair the number again. No console
action SHALL permanently delete an account or the data belonging to it.

The console SHALL show when an account was deactivated, and SHALL NOT claim of
a deactivated account that nothing was deleted or that reactivation restores it
exactly as it was.

#### Scenario: Deactivation is confirmed before it applies

- **WHEN** an operator chooses to deactivate an account
- **THEN** the console asks them to confirm against the account's name, and
  nothing changes until they do

#### Scenario: The connection loss is stated before confirming

- **WHEN** an operator is asked to confirm deactivating an account
- **THEN** the confirmation states that the WhatsApp connection will be deleted
  and that the client will have to pair the number again, before the operator
  confirms rather than after

#### Scenario: Data survives deactivation

- **WHEN** an account is deactivated and then reactivated
- **THEN** its contacts, deals, conversations, messages and configuration are
  exactly as they were before

#### Scenario: The connection does not survive deactivation

- **WHEN** a connected account is deactivated and then reactivated
- **THEN** it reads as not connected, carries no paired number, and the client
  is invited to pair a number again

#### Scenario: Reactivation restores access

- **WHEN** an operator reactivates a deactivated account
- **THEN** its members can sign in again and the account reads as active

#### Scenario: The console does not promise a lossless deactivation

- **WHEN** an operator views a deactivated account
- **THEN** nothing on the page states that nothing was deleted or that
  reactivation restores the account exactly as it was

#### Scenario: Nothing offers permanent deletion

- **WHEN** an operator views an account in the console
- **THEN** no control offers to delete the account or its data

#### Scenario: Non-operator cannot change activation state

- **WHEN** a signed-in user who is not a platform operator submits a
  deactivation or reactivation
- **THEN** the request is rejected and the account's state is unchanged

## ADDED Requirements

### Requirement: Deactivating an account releases its gateway instance

Deactivating an account SHALL delete that account's instance on the messaging
gateway and SHALL clear the instance credentials and pairing details the system
holds for it, so that the account is left in the same unconfigured state a
never-connected account starts from. An instance SHALL NOT outlive the client
it was provisioned for: it occupies a paid slot on the gateway and keeps a live
WhatsApp session for a clinic that is no longer a client.

Deactivating an account that has no instance — one never connected, or one the
client already disconnected — SHALL succeed with nothing to release and SHALL
NOT be reported as a failure.

Reactivation SHALL NOT provision an instance. The account's own connection
screen already provisions one when the client next opens it.

#### Scenario: A connected account's instance is released

- **WHEN** an operator deactivates an account whose number is paired
- **THEN** that account's gateway instance is deleted and the stored instance
  credentials, connection state, paired number and pairing time are cleared

#### Scenario: An account with no instance deactivates cleanly

- **WHEN** an operator deactivates an account that has never connected, or one
  whose client has already disconnected
- **THEN** the deactivation succeeds and reports no failure

#### Scenario: Reactivation does not bring an instance back

- **WHEN** an operator reactivates an account that was deactivated while
  connected
- **THEN** no instance is provisioned for it, and one is created only when the
  client next opens the connection screen

#### Scenario: Only that account's instance is released

- **WHEN** an operator deactivates an account
- **THEN** no other account's instance is deleted or altered

### Requirement: A gateway failure does not block a deactivation

A deactivation SHALL NOT be refused, rolled back or left half-applied because
the messaging gateway could not be reached or rejected the delete. The account
SHALL still be deactivated, its waiting conversions SHALL still be cancelled,
and the stored instance credentials and pairing details SHALL still be cleared,
because the operator's goal — this clinic is no longer a client — is satisfied
locally regardless of what the gateway reports.

When the gateway delete does not succeed, the console SHALL warn the operator
that an instance was left behind and SHALL name it with enough identifying
detail for the operator to find and remove it by hand on the gateway. A gateway
that reports the instance as already gone SHALL NOT produce that warning: that
is the outcome the delete wanted.

#### Scenario: The gateway is unreachable

- **WHEN** an operator deactivates an account and the gateway cannot be reached
- **THEN** the account is still deactivated, its stored instance credentials and
  pairing details are still cleared, and the operator is warned that an instance
  was left behind

#### Scenario: The orphan is identified well enough to remove

- **WHEN** the console warns that an instance was left behind
- **THEN** the warning names that instance with enough detail for the operator
  to locate it on the gateway and delete it by hand

#### Scenario: An instance already gone is not reported as an orphan

- **WHEN** the gateway reports that the account's instance no longer exists
- **THEN** the deactivation completes with no orphan warning
