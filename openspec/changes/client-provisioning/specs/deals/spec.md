## ADDED Requirements

### Requirement: A pipeline stage can be protected as a system stage

A pipeline stage MAY be marked as a system stage. A system stage exists so that
every new lead has one guaranteed, never-moving entry point that other parts of
the product can point at.

While a stage is marked as a system stage, the system SHALL refuse to rename it,
delete it, or move it out of the first position of its pipeline. The refusal
SHALL hold for every path that reaches the data — the pipeline settings screen,
any API, and any direct database write by a client session — not only for the
screen. An attempt to reorder the pipeline in a way that would displace the
system stage SHALL be rejected as a whole; the other stages SHALL NOT be
partially reordered.

The stage's colour SHALL remain editable, and deals SHALL move in and out of a
system stage exactly as they do for any other stage. Deleting the pipeline
itself SHALL delete its system stage along with the rest, as before.

At most one stage per pipeline SHALL be a system stage. A stage created by a
client SHALL NOT be a system stage.

#### Scenario: Rename is refused

- **WHEN** a member with settings-editing permission renames the system stage
  and saves
- **THEN** the save is rejected with an explanatory message and the stage keeps
  its name

#### Scenario: Delete is refused

- **WHEN** a member with settings-editing permission deletes the system stage
- **THEN** the deletion is rejected with an explanatory message and the stage
  remains

#### Scenario: Reorder away from first position is refused

- **WHEN** a member drags another stage above the system stage and saves
- **THEN** the whole save is rejected, the system stage stays first, and no other
  stage's position changes

#### Scenario: Refusal holds outside the settings screen

- **WHEN** a client session issues a direct write that would rename or delete the
  system stage, bypassing the settings screen
- **THEN** the write fails

#### Scenario: Colour is still editable

- **WHEN** a member changes the system stage's colour and saves
- **THEN** the save succeeds

#### Scenario: Deals move through the system stage normally

- **WHEN** a deal is dragged out of the system stage into the next stage, and
  later dragged back
- **THEN** both moves succeed

#### Scenario: Other stages stay fully editable

- **WHEN** a member renames, reorders, or deletes a stage that is not the system
  stage
- **THEN** the change is accepted

#### Scenario: A client-created stage is ordinary

- **WHEN** a member adds a new stage to a pipeline that already has a system
  stage
- **THEN** the new stage is not a system stage and can be renamed, reordered, and
  deleted
