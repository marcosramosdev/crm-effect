## ADDED Requirements

### Requirement: The console carries the register of platform operators

The console SHALL offer a screen listing every platform operator, showing for
each one: their name, their e-mail address, their role, who registered them and
when. An operator seeded by the deployment configuration SHALL be listed too,
marked as seeded and carrying no registrar, so the screen answers "who can get
in" completely rather than listing only the records.

The screen SHALL be reachable only by an operator holding the manager role, and
that SHALL be re-checked on the server for every read.

#### Scenario: Manager reads the register

- **WHEN** an operator holding the manager role opens the operator screen
- **THEN** every operator is listed with their name, address, role, registrar
  and registration time

#### Scenario: Seeded operator is listed without a registrar

- **WHEN** the register is read on a deployment whose configuration seeds an
  address that has no record
- **THEN** that address is listed as an operator holding the manager role,
  marked as seeded, with no registrar shown

#### Scenario: Admin cannot read the register

- **WHEN** an operator holding the admin role opens the operator screen or
  requests its data
- **THEN** the request is refused and no operator's details are disclosed

### Requirement: Registering an operator creates their sign-in identity

A manager SHALL register an operator by supplying their name, e-mail address,
role and a password of the manager's choosing. A successful registration SHALL
produce both a sign-in identity for that address, already confirmed, and the
operator record carrying the chosen role, the registering operator and the
moment of registration.

The system SHALL NOT send any e-mail as part of registration. The chosen
password SHALL be shown to the manager once, so it can be delivered through
their own channel, and SHALL NOT be stored anywhere beyond the sign-in identity
or written to any log.

When the address already has a sign-in identity and no operator record — which
is what a previously removed operator leaves behind — registration SHALL attach
the role to that identity, SHALL leave its password untouched, and SHALL state
that it did so rather than reporting a new password. A password SHALL be
required only where an identity has to be created.

An address that already holds an operator record SHALL be refused, as SHALL a
password below the minimum the sign-in system accepts, and in both cases
nothing SHALL be created. A registration that cannot complete SHALL leave
neither a sign-in identity nor a record behind.

The registered operator SHALL NOT become a member of any client account.

#### Scenario: Manager registers an operator and delivers the password

- **WHEN** a manager registers an operator with a name, address, role and
  password
- **THEN** the operator can sign in immediately with that password, the console
  shows the password once, and no message is sent to them

#### Scenario: The record says who registered whom

- **WHEN** a manager registers an operator
- **THEN** that operator's entry names the registering operator and the moment
  of registration

#### Scenario: An address that is already an operator is refused

- **WHEN** a manager registers an address that already holds an operator record
- **THEN** the registration is refused with an explanatory message and nothing
  is created

#### Scenario: An existing sign-in keeps its password

- **WHEN** a manager registers an address that has a sign-in identity but no
  operator record
- **THEN** that identity becomes an operator with the chosen role, its password
  is unchanged, and the console says so instead of showing a new password

#### Scenario: Weak password is refused

- **WHEN** a manager submits a password shorter than the minimum the sign-in
  system accepts
- **THEN** the registration is refused before anything is created

#### Scenario: An admin cannot register anyone

- **WHEN** an operator holding the admin role submits a registration
- **THEN** it is rejected and nothing is created

### Requirement: Removing an operator withdraws the console, not the sign-in identity

A manager SHALL be able to remove an operator. Removal SHALL delete that
operator's record, after which they SHALL be treated exactly as any signed-in
user who is not an operator: the console is unreachable and behaves as though
it does not exist for them.

Removal SHALL NOT delete their sign-in identity, and SHALL NOT touch any client
account. Registering the same address again SHALL restore their access.

An operator whose address is seeded by the deployment configuration SHALL NOT
be removable — the seed would return them at the next check — and the console
SHALL say so rather than offering a control that silently fails.

#### Scenario: Removed operator loses the console

- **WHEN** a manager removes an operator and that person opens the console
- **THEN** they are sent away with no indication that a console exists

#### Scenario: The sign-in identity survives removal

- **WHEN** a manager removes an operator
- **THEN** that person's sign-in identity still exists and no client account is
  changed

#### Scenario: Re-registering restores access

- **WHEN** a manager registers a removed operator's address again
- **THEN** that operator reaches the console with the role given in the new
  registration

#### Scenario: A seeded operator cannot be removed

- **WHEN** a manager views an operator whose address is seeded by the
  deployment configuration
- **THEN** the console states that they are seeded and offers no removal, and a
  removal submitted for them is refused

#### Scenario: An admin cannot remove anyone

- **WHEN** an operator holding the admin role submits a removal
- **THEN** it is rejected and the operator record is unchanged

### Requirement: No operator can remove or promote themselves

An operator's role SHALL be fixed at registration. The system SHALL offer no
surface that changes an existing operator's role; a role change SHALL be
performed by removing the operator and registering them again, which only a
manager can do.

A manager SHALL NOT be able to remove their own record, so that the act of
signing in never costs an operator their own access.

#### Scenario: Self-removal is refused

- **WHEN** a manager submits a removal naming their own record
- **THEN** it is rejected and the record is unchanged

#### Scenario: Nothing offers a role change

- **WHEN** an operator views the register
- **THEN** no control offers to change any operator's role, their own included

#### Scenario: Promotion goes through re-registration

- **WHEN** a manager needs an admin to become a manager
- **THEN** they remove that operator and register the address again with the
  manager role

### Requirement: An operator never enters a client surface

An operator is a member of no client account. Signing in with an operator's
address SHALL lead to the console, never to a client surface. An operator who
opens a client route directly SHALL be sent to the console.

No client surface SHALL render for an operator: no account sidebar, no
suggestion to change a delivered password, and no pending setup step for
connecting WhatsApp or configuring advertising. The control that ends an
operator's session SHALL live inside the console, and the console SHALL show
which operator is signed in.

This SHALL hold for an operator whose sign-in identity also owns an account of
its own, which the system creates for every new sign-in identity.

#### Scenario: Sign-in lands on the console

- **WHEN** an operator signs in with their address and password
- **THEN** they arrive at the console

#### Scenario: A client route sends an operator back

- **WHEN** an operator opens a client route directly
- **THEN** they are sent to the console and no client surface is rendered

#### Scenario: No client pendings are shown to an operator

- **WHEN** an operator is signed in
- **THEN** nothing prompts them to connect a WhatsApp number, configure
  advertising, or change a delivered password

#### Scenario: Signing out lives in the console

- **WHEN** an operator wants to end their session
- **THEN** the console shows who is signed in and offers the control that ends
  it

## MODIFIED Requirements

### Requirement: The console lists every account with its operational state

The operator console SHALL present every provisioned client account in one
list. Each entry SHALL carry, without the operator opening anything: the
account's name, whether it is active or deactivated, its messaging connection
state, its advertising configuration state, and its conversion counts.

The account the system creates for an operator's own sign-in identity SHALL NOT
be listed: the roster answers which clinics are clients, and an operator is not
one.

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
- **THEN** every provisioned client account appears with its activation state,
  its connection state, advertising state and conversion counts

#### Scenario: Operators' own accounts are absent from the roster

- **WHEN** the console renders on a deployment where operators have signed in
- **THEN** no account belonging to an operator's own sign-in identity is listed

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
