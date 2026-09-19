## MODIFIED Requirements

### Requirement: The console lists every account with its operational state

The operator console SHALL present every provisioned account in one list. Each
entry SHALL carry, without the operator opening anything: the account's name,
whether it is active or deactivated, its messaging connection state, its
advertising configuration state, and its conversion counts.

Active and deactivated accounts SHALL be visually separated, so that the roster
answers "who are our clients today" at a glance. A deactivated account SHALL
remain listed; it SHALL NOT disappear from the console.

The list SHALL be readable by a platform operator only, under the same
allow-list that guards provisioning, and SHALL be re-checked on the server for
every read rather than trusting the browser.

An account that has produced no conversions SHALL read as having none yet, not
as an error or an empty failure state.

#### Scenario: Operator sees the roster

- **WHEN** a platform operator opens the console
- **THEN** every provisioned account appears with its activation state, its
  connection state, advertising state and conversion counts

#### Scenario: Deactivated accounts are separated, not hidden

- **WHEN** the console renders with both active and deactivated accounts
- **THEN** the deactivated ones are listed apart from the active ones and
  marked as deactivated

#### Scenario: Newly provisioned account reads as quiet, not broken

- **WHEN** an account exists that has never had a conversion recorded
- **THEN** its entry states that it has no conversions yet

#### Scenario: Non-operator is turned away

- **WHEN** a signed-in user whose address is not on the platform-operator
  allow-list requests the account list
- **THEN** the request is refused and no account data is disclosed

## ADDED Requirements

### Requirement: An operator can correct an account's name

The console SHALL let a platform operator change an account's name, taking
effect everywhere the name is shown, for the client as well as the operator.
An empty name SHALL be refused: provisioning guarantees every account has one,
and renaming SHALL NOT be able to undo that.

This action SHALL be restricted to platform operators by the same allow-list
that guards the rest of the console, re-checked on the server on submission.

#### Scenario: Rename takes effect

- **WHEN** an operator renames an account
- **THEN** the new name is shown in the roster and on the client's own surfaces

#### Scenario: Empty name is refused

- **WHEN** an operator submits a blank name
- **THEN** the change is rejected and the account keeps its previous name

#### Scenario: Non-operator cannot rename

- **WHEN** a signed-in user who is not a platform operator submits a rename
- **THEN** the request is rejected and nothing is written

### Requirement: An operator can reissue the client's password

Because the client's password was chosen and delivered by an operator, the
console SHALL let an operator set a new password for an account's owner and
SHALL show that password once, so it can be delivered through the operator's
own channel.

The system SHALL NOT e-mail the new password, SHALL NOT store it anywhere
beyond the sign-in identity itself, and SHALL NOT write it to any log. A
password below the minimum the sign-in system accepts SHALL be refused before
anything changes.

Reissuing SHALL invalidate the owner's existing sessions, so that a password
delivered to the client is the only way back in.

#### Scenario: Operator reissues and delivers

- **WHEN** an operator sets a new password for an account's owner
- **THEN** the console shows that password once and no message is sent to the
  client

#### Scenario: Client signs in with the reissued password

- **WHEN** the owner signs in with the password the operator delivered
- **THEN** sign-in succeeds and the previous password no longer works

#### Scenario: Old sessions do not survive

- **WHEN** an operator reissues the owner's password while that owner has a
  live session
- **THEN** that session no longer grants access

#### Scenario: Weak password is refused

- **WHEN** an operator submits a password shorter than the minimum
- **THEN** the change is rejected and the existing password still works

### Requirement: An account can be taken out of service without losing anything

The console SHALL let a platform operator deactivate an account and reactivate
a deactivated one. Deactivation SHALL be reversible and SHALL destroy nothing:
the account's contacts, deals, conversations and configuration SHALL survive it
unchanged, and reactivation SHALL restore access to exactly what was there.

Because deactivation cuts the client off from the product, the console SHALL
ask the operator to confirm before applying it, naming the account. No console
action SHALL permanently delete an account.

The console SHALL show when an account was deactivated.

#### Scenario: Deactivation is confirmed before it applies

- **WHEN** an operator chooses to deactivate an account
- **THEN** the console asks them to confirm against the account's name, and
  nothing changes until they do

#### Scenario: Data survives deactivation

- **WHEN** an account is deactivated and then reactivated
- **THEN** its contacts, deals, conversations and configuration are exactly as
  they were before

#### Scenario: Reactivation restores access

- **WHEN** an operator reactivates a deactivated account
- **THEN** its members can sign in again and the account reads as active

#### Scenario: Nothing offers permanent deletion

- **WHEN** an operator views an account in the console
- **THEN** no control offers to delete the account or its data

#### Scenario: Non-operator cannot change activation state

- **WHEN** a signed-in user who is not a platform operator submits a
  deactivation or reactivation
- **THEN** the request is rejected and the account's state is unchanged

### Requirement: A deactivated account's people cannot use the product

While an account is deactivated, no member of it SHALL be able to sign in, and
any live session belonging to one SHALL stop granting access — the check SHALL
be made on the server on each request, not only at sign-in.

A member turned away for this reason SHALL be told that their access has been
suspended and that they should contact the agency, rather than being shown a
wrong-password or generic failure.

Deactivation SHALL NOT affect a platform operator's access to the console or to
that account's page.

#### Scenario: Sign-in is refused while deactivated

- **WHEN** a member of a deactivated account signs in with correct credentials
- **THEN** access is refused and they are told their access is suspended

#### Scenario: A live session stops working

- **WHEN** an account is deactivated while one of its members has the product
  open
- **THEN** that member's next request is turned away

#### Scenario: Operators still see the account

- **WHEN** an operator opens a deactivated account's console page
- **THEN** it renders, showing the account as deactivated

### Requirement: A deactivated account reports no conversions

While an account is deactivated, the system SHALL NOT report conversions to
Meta for it. Inbound messages SHALL still be received and stored, so that
reactivating an account does not lose the traffic that arrived meanwhile.

Deactivating an account SHALL cancel the conversions it has waiting to be
delivered, because the ad clicks behind them go stale within days and Meta
would reject them on return. Reactivation SHALL NOT revive them, and the
console SHALL state this where it asks the operator to confirm.

#### Scenario: No conversion leaves a deactivated account

- **WHEN** a conversion would be delivered for an account that is deactivated
- **THEN** nothing is sent to Meta

#### Scenario: Waiting conversions are cancelled on deactivation

- **WHEN** an account with conversions waiting to be delivered is deactivated
- **THEN** those conversions are cancelled, and reactivating the account does
  not restore them

#### Scenario: The operator is told before confirming

- **WHEN** an operator is asked to confirm deactivating an account that has
  conversions waiting
- **THEN** the confirmation states that those conversions will be cancelled

#### Scenario: Inbound traffic is still kept

- **WHEN** a message arrives for a deactivated account
- **THEN** it is stored as usual and is present after reactivation
