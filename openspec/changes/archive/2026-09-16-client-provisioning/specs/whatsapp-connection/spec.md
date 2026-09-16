## MODIFIED Requirements

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
