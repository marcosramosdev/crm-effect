## ADDED Requirements

### Requirement: Instance teardown when an account leaves service

An account's gateway instance SHALL NOT outlive the account's time in service.
When a platform operator takes an account out of service, the system SHALL
delete that account's gateway instance and clear every stored credential and
pairing detail for it — the instance identifier, the instance token, the
connection state, the paired phone number and the pairing time — leaving the
account in the same unconfigured state a never-connected account starts from,
exactly as a client-initiated disconnect does.

The delete SHALL be scoped to the account's own instance and MUST NOT be able
to affect any other account's instance.

An account with no provisioned instance SHALL be taken out of service without
error: there is nothing to release.

Returning the account to service SHALL NOT provision a new instance. The
account returns unconfigured, and the next login on its connection screen
provisions a fresh instance as it does for a never-connected account.

#### Scenario: Leaving service deletes the instance

- **WHEN** an account with a provisioned instance is taken out of service
- **THEN** its gateway instance is deleted and its stored instance identifier,
  instance token, paired phone number and pairing time are cleared, and its
  stored state becomes `disconnected`

#### Scenario: Teardown only touches the account's own instance

- **WHEN** an account is taken out of service
- **THEN** the gateway delete is authenticated with that account's own instance
  credential, so instances belonging to other accounts are untouched

#### Scenario: Nothing to release

- **WHEN** an account with no provisioned instance is taken out of service
- **THEN** no gateway call is attempted and the operation reports no failure

#### Scenario: Returning to service leaves the account unconfigured

- **WHEN** an account that was torn down is returned to service and its client
  opens the connection screen
- **THEN** the account reads as never connected and a fresh instance is
  provisioned for the login, rather than the deleted one being reused

### Requirement: A teardown the gateway refuses is reported, not swallowed

Unlike a client-initiated disconnect — where the operator's goal is satisfied
locally and a gateway failure is only logged — a teardown driven by an account
leaving service SHALL report a gateway failure to the platform operator who
triggered it, because nobody else will ever go looking for the instance it
leaves running.

The local state SHALL still be cleared and the account SHALL still leave
service. The report SHALL identify the instance that was left behind well
enough for the operator to find and delete it by hand on the gateway.

A gateway that reports the instance as already gone SHALL NOT be treated as a
failure.

#### Scenario: Gateway failure is surfaced with the orphan's identity

- **WHEN** the gateway rejects the delete or cannot be reached during a teardown
- **THEN** the stored credentials and pairing details are still cleared, the
  account still leaves service, and the operator is told which instance was
  left running on the gateway

#### Scenario: Already gone is not a failure

- **WHEN** the gateway reports that the instance no longer exists
- **THEN** the teardown completes and nothing is reported to the operator
