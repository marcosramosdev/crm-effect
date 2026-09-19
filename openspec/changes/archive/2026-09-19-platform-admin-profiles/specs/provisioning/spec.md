## MODIFIED Requirements

### Requirement: The provisioning console is restricted to platform operators

The system SHALL restrict the provisioning console to platform operators. The
platform-operator allow-list SHALL be the union of two sources: the operator
records the system holds, and the deployment-configured e-mail addresses that
seed them. An address present in the deployment configuration SHALL be an
operator holding the manager role whether or not a record exists for it, so
that a deployment can never be left with nobody able to sign in. Membership in
that allow-list SHALL be the only credential that grants access; a role inside
a client account SHALL NOT grant it, and no client-account role SHALL be able
to read or write the operator records.

An operator SHALL hold exactly one of two roles:

- **manager** — may do everything an admin may do, and is additionally the only
  role that may register and remove operators;
- **admin** — may do everything the console offers concerning client accounts:
  provision an account, rename it, reissue its owner's password, deactivate it,
  reactivate it, and edit its advertising configuration.

Neither role SHALL be scoped to the accounts that operator created: every
operator SHALL see and act on every account.

A signed-in user who is not on the allow-list SHALL be treated as though the
console does not exist. An operator holding the admin role who reaches a
manager-only surface SHALL be refused in the same way.

Every operator action SHALL re-check the allow-list and the acting operator's
role on the server, rather than trusting a check already made by the browser.

#### Scenario: Listed operator reaches the console

- **WHEN** a signed-in user who holds an operator record opens the provisioning
  console
- **THEN** the console renders

#### Scenario: Seeded address is an operator with no record

- **WHEN** a signed-in user whose address is in the deployment configuration,
  and for whom no operator record exists, opens the console
- **THEN** the console renders and that user is treated as holding the manager
  role

#### Scenario: Admin does everything concerning client accounts

- **WHEN** an operator holding the admin role provisions an account, renames
  one, reissues an owner's password, deactivates or reactivates an account, or
  edits an account's advertising configuration
- **THEN** each action is accepted

#### Scenario: Admin sees every account

- **WHEN** an operator holding the admin role opens the console on a deployment
  whose accounts were provisioned by other operators
- **THEN** every account is listed, with no filtering by who created it

#### Scenario: Admin cannot reach a manager-only surface

- **WHEN** an operator holding the admin role opens or submits to a surface
  reserved for the manager role
- **THEN** the request is refused and nothing is written

#### Scenario: Ordinary client owner is turned away

- **WHEN** the owner of a client account, who is not on the allow-list, opens
  the provisioning console
- **THEN** they are sent away with no indication that a console exists, and no
  provisioning data is disclosed

#### Scenario: Unauthenticated visitor is turned away

- **WHEN** a visitor with no session opens the provisioning console
- **THEN** they are sent to the sign-in screen

#### Scenario: Server re-checks on submit

- **WHEN** a provisioning submission arrives from a session that is not on the
  allow-list
- **THEN** it is rejected and nothing is created, regardless of what the browser
  sent

#### Scenario: Allow-list is unset

- **WHEN** a deployment holds no operator records and configures no seed
  addresses
- **THEN** the console is reachable by nobody

#### Scenario: A client session cannot read the operator records

- **WHEN** a signed-in user who is not an operator attempts to read the operator
  records
- **THEN** the attempt is refused and no operator's name, address or role is
  disclosed
