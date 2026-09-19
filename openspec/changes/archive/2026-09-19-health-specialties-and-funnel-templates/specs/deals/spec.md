## ADDED Requirements

### Requirement: A "Perdido" stage organises the board and does not carry the status

Every seeded funnel ends with a stage named "Perdido". That stage is the team's
visual parking place for deals they have given up on. It SHALL NOT be wired to
the deal's `open` / `qualified` / `lost` status in either direction:

- Moving a deal into or out of the "Perdido" stage SHALL leave its status, its
  recorded loss reason, and its conversion mark exactly as they were.
- Marking a deal lost, or reopening a lost deal, SHALL leave the deal in the
  stage it is already in and SHALL NOT move its card.

Marking a deal lost, with the optional reason the system already captures,
remains the only way the status changes. The stage name carries no meaning the
system acts on; renaming or deleting it SHALL be permitted like any other
non-system stage, and doing so SHALL NOT change the status of any deal sitting
in it.

A board SHALL be able to show a deal whose status is `lost` in any stage, and a
deal whose status is `open` in the "Perdido" stage, without treating either as
an inconsistency to repair.

#### Scenario: Dragging a card into "Perdido" changes no status

- **WHEN** an agent drags an open deal's card into the "Perdido" stage
- **THEN** the deal moves stage and its status is still `open`, with no loss
  reason recorded and no prompt to record one

#### Scenario: Marking a deal lost does not move its card

- **WHEN** an agent marks a deal lost from a stage other than "Perdido"
- **THEN** the deal's status becomes lost and its card stays in the stage it was
  already in

#### Scenario: Dragging out of "Perdido" does not reopen

- **WHEN** an agent drags a card whose status is `lost` out of the "Perdido"
  stage into an earlier stage
- **THEN** the deal moves stage and its status is still `lost`, with its
  recorded reason intact

#### Scenario: Reopening a lost deal leaves it where it is

- **WHEN** an agent reopens a lost deal sitting in the "Perdido" stage
- **THEN** the deal's status becomes open and its card remains in "Perdido"

#### Scenario: Renaming the stage changes no deal

- **WHEN** a member renames the "Perdido" stage or deletes it
- **THEN** the change is accepted and the status of every deal that was in it is
  unchanged
