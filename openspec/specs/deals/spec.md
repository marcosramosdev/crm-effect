# Deals Specification

## Purpose

Defines what an operator can record on and edit about a deal: its built-in
attributes, the account-wide catalogue of typed custom fields that applies to
every deal, the per-deal values for those fields, the deal's note history, and
how a pipeline board can be narrowed by custom field value. Deal movement
between stages and pipelines is specified elsewhere (the `inbox` capability for
the inbox surface, drag-and-drop on the board).

## Requirements

### Requirement: Account-wide typed custom field catalogue for deals

The system SHALL maintain a catalogue of custom field definitions that belongs
to the account and applies to **every** deal in that account, independent of
pipeline, stage, or owner. This catalogue SHALL be separate from the contact
custom field catalogue: creating a deal field SHALL NOT create a contact field,
and neither catalogue's definitions SHALL appear when editing the other kind of
record.

Each definition SHALL have a name, a display position, and a type drawn from:
`text`, `number`, `date`, `select`, and `checkbox`. A `select` definition SHALL
carry an ordered list of at least one allowed option. Definition names SHALL be
unique within the account, compared case-insensitively.

Only a member with settings-editing permission SHALL be able to create, rename,
retype, reorder, or delete a definition. Any member SHALL be able to read the
catalogue. Deleting a definition SHALL delete the values recorded against it on
every deal.

#### Scenario: A new field appears on every deal

- **WHEN** an admin creates a deal custom field named "Contract number"
- **THEN** that field is offered when editing any deal in the account, including
  deals created before the field existed and deals on other pipelines, with no
  value recorded until one is entered

#### Scenario: Duplicate name is rejected

- **WHEN** an admin creates a deal custom field whose name matches an existing
  one ignoring case
- **THEN** the definition is not created and the admin is told the name is
  already in use

#### Scenario: Select definition requires options

- **WHEN** an admin saves a `select` definition with an empty option list
- **THEN** the definition is not saved and the admin is told at least one option
  is required

#### Scenario: Deal and contact catalogues are independent

- **WHEN** an admin views the deal custom field catalogue in an account that
  already has contact custom fields defined
- **THEN** only deal field definitions are listed, and a field created here does
  not appear on the contact record

#### Scenario: Non-admin cannot change the catalogue

- **WHEN** a member without settings-editing permission opens the deal custom
  field catalogue
- **THEN** the definitions are shown read-only with no create, rename, retype,
  reorder, or delete affordance

#### Scenario: Deleting a definition discards its values

- **WHEN** an admin deletes a deal custom field that has values recorded on
  several deals
- **THEN** the definition and all of its recorded values are removed, and no
  deal retains an orphaned value

### Requirement: Custom field values are recorded per deal and validated by type

A deal SHALL be able to hold at most one value per custom field definition.
Values SHALL be editable by any member with send permission and SHALL be
readable by any member. An absent value SHALL be distinguishable from a value
that has been cleared to empty in the sense that both present as "not set"; the
system SHALL NOT invent a default.

A submitted value SHALL be rejected when it does not conform to its
definition's type: a `number` value that is not numeric, a `date` value that is
not a valid calendar date, or a `select` value that is not one of the
definition's current options. A `checkbox` value SHALL be exactly set or unset.
Rejection SHALL leave the previously stored value unchanged and SHALL tell the
operator which field is invalid.

Custom field values SHALL be shown when editing a deal. They SHALL NOT be
rendered on the pipeline board's deal card.

#### Scenario: Enter and persist a typed value

- **WHEN** an agent sets a `date` custom field on a deal to a valid date and
  saves
- **THEN** the value is persisted against that deal and that field, and is shown
  on the next open of the deal

#### Scenario: Invalid value is rejected

- **WHEN** an agent submits a non-numeric value for a `number` custom field
- **THEN** the save is rejected, the field is identified as invalid, and the
  previously stored value is unchanged

#### Scenario: Option no longer offered

- **WHEN** a `select` custom field's options are changed by an admin so that a
  value already recorded on a deal is no longer among them
- **THEN** the deal still reports its stored value, and re-saving the deal
  requires choosing one of the current options

#### Scenario: Values are absent from the board card

- **WHEN** an operator views the pipeline board for deals that have custom field
  values recorded
- **THEN** the deal cards show no custom field values

#### Scenario: Read-only member

- **WHEN** a member without send permission opens a deal
- **THEN** custom field values are displayed but cannot be edited

### Requirement: Filter a pipeline board by custom field value

The pipeline board SHALL let an operator narrow the deals it displays by the
value of a deal custom field. The operator SHALL be able to select a definition
and constrain it, at minimum, to a specific value and to "has any value" /
"has no value". While a filter is active the board SHALL show only matching
deals, and SHALL indicate that a filter is applied and offer to clear it.

Stage columns SHALL remain visible while filtered, showing only the matching
deals in each. Per-stage counts and totals SHALL reflect the filtered set, not
the unfiltered one. Clearing the filter SHALL restore the full board.

#### Scenario: Filter to a specific value

- **WHEN** an operator filters the board by a `checkbox` field "Contract signed"
  set to yes
- **THEN** only deals whose stored value for that field is set are shown across
  the stage columns, and the per-stage counts and totals reflect only those
  deals

#### Scenario: Filter for a missing value

- **WHEN** an operator filters the board by "has no value" for a custom field
- **THEN** only deals with no recorded value for that field are shown

#### Scenario: Empty result

- **WHEN** an active filter matches no deals
- **THEN** the board shows its stage columns with no cards and communicates that
  a filter is hiding deals, with a way to clear it

#### Scenario: Clearing restores the board

- **WHEN** an operator clears an active filter
- **THEN** every deal on the pipeline is shown again and the counts and totals
  return to their unfiltered values

### Requirement: Deals carry additional built-in attributes

A deal SHALL record, in addition to the attributes it already carries, a
win probability as a whole percentage from 0 to 100, a priority of `low`,
`medium`, or `high`, a free-text source, and a free-text description. All four
SHALL be optional, editable by a member with send permission, and SHALL default
to unset rather than to a fabricated value.

A probability outside 0–100 SHALL be rejected without changing the stored
value.

#### Scenario: Set probability and priority

- **WHEN** an agent sets a deal's probability to 60 and its priority to high
- **THEN** both are persisted and shown on the next open of the deal

#### Scenario: Out-of-range probability

- **WHEN** an agent submits a probability of 140
- **THEN** the save is rejected, the field is identified as invalid, and the
  stored probability is unchanged

#### Scenario: Attributes are optional

- **WHEN** an agent creates a deal without touching the new attributes
- **THEN** the deal is created with all four unset, and the board and analytics
  treat them as absent rather than as zero, low, or empty

### Requirement: Marking a deal lost captures a reason

When a deal is marked lost, the system SHALL offer to record a free-text reason
alongside the status change. The reason SHALL be optional — declining to give
one SHALL still mark the deal lost. A recorded reason SHALL be visible when the
deal is next opened.

Reopening a lost deal SHALL preserve the recorded reason rather than erasing it,
so the history of why it was lost survives.

#### Scenario: Lost with a reason

- **WHEN** an agent marks a deal lost and enters "went with a competitor"
- **THEN** the deal's status becomes lost and the reason is stored and shown on
  the deal

#### Scenario: Lost without a reason

- **WHEN** an agent marks a deal lost and leaves the reason blank
- **THEN** the deal's status becomes lost with no reason recorded

#### Scenario: Reopening preserves the reason

- **WHEN** a lost deal that has a recorded reason is reopened
- **THEN** the deal's status becomes open and the previously recorded reason is
  still readable on the deal

### Requirement: Deals have an appendable note history

A deal SHALL hold an ordered history of notes rather than a single overwritable
block of text. Each note SHALL record its text, the member who wrote it, and the
time it was written, and SHALL be displayed newest first. Any member with send
permission SHALL be able to append a note; appending SHALL NOT modify or replace
existing notes. A member SHALL be able to delete a note.

Text previously held in the deal's single notes field SHALL be preserved as the
deal's first note entry, so no existing content is lost.

#### Scenario: Append a note

- **WHEN** an agent adds a note to a deal that already has two notes
- **THEN** the deal has three notes, the new one is shown first with its author
  and timestamp, and the earlier two are unchanged

#### Scenario: Existing notes text survives

- **WHEN** a deal that carried text in the previous single notes field is opened
  after this change
- **THEN** that text is present as a note entry on the deal

#### Scenario: Read-only member

- **WHEN** a member without send permission opens a deal's notes
- **THEN** the note history is readable and no note can be added or deleted

### Requirement: Deals are edited through a detail view

A deal SHALL be editable through a detail view that presents its built-in
attributes, its custom field values, and its note history as distinct sections
the operator can move between without losing unsaved edits in the others. The
detail view SHALL also surface the deal's linked conversation, when it has one,
as a way to reach that thread.

The detail view SHALL be reachable from the pipeline board. Saving SHALL persist
built-in attributes and custom field values together: if any part of the save
fails, the operator SHALL be told and SHALL NOT be left believing a rejected
value was stored.

The detail view SHALL show whether the deal is archived. For an operator with
send permission it SHALL offer an archive action when the deal is not archived
and an unarchive action when it is; a member without send permission SHALL see
the archived state with no control to change it.

#### Scenario: Move between sections without losing edits

- **WHEN** an agent edits a deal's value, switches to the custom fields section,
  enters a value there, and switches back
- **THEN** both the edited deal value and the entered custom field value are
  still present and unsaved, and saving persists both

#### Scenario: Partial save failure is surfaced

- **WHEN** a save is rejected because one custom field value is invalid
- **THEN** the operator is told which field is invalid and the deal is not
  reported as saved

#### Scenario: Reach the linked conversation

- **WHEN** an agent opens a deal whose contact has a conversation
- **THEN** the detail view offers a way to open that conversation

#### Scenario: Archive from the detail view

- **WHEN** an agent with send permission opens a deal that is not archived and
  activates the archive action
- **THEN** the deal becomes archived, the detail view reflects the archived
  state, and an unarchive action is offered in its place

#### Scenario: Read-only member sees archived state

- **WHEN** a member without send permission opens an archived deal
- **THEN** the detail view shows that the deal is archived and offers no
  archive or unarchive control

### Requirement: Rename a deal and change its value from the board card

An operator with send permission SHALL be able to change a deal's title, its
monetary value, and its expected close date directly on its pipeline board
card, and SHALL be able to archive the deal from the card, all without opening
the deal detail view.

Title and value edits SHALL be committed on confirmation and SHALL be
discardable without saving. Changing the expected close date SHALL let the
operator pick a date or clear it and SHALL be committed on selection.
Archiving from the card SHALL require an explicit confirmation step, because it
removes the card from the board.

The card SHALL update immediately on commit and the change SHALL be persisted;
a failed persist SHALL revert the card and surface an error. Editing on the
card SHALL NOT move the deal between stages, and SHALL NOT interfere with
dragging the card.

A member without send permission SHALL see no inline-edit, close-date, or
archive affordance on the card.

#### Scenario: Rename on the card

- **WHEN** an agent edits a deal's title on its board card and confirms
- **THEN** the card shows the new title immediately and the title is persisted

#### Scenario: Discard an inline edit

- **WHEN** an agent starts editing a deal's value on the card and cancels
- **THEN** the card returns to the previously stored value and nothing is
  persisted

#### Scenario: Change the close date from the card

- **WHEN** an agent picks a new expected close date on a deal's board card
- **THEN** the card shows the new date immediately and the date is persisted,
  without the deal detail view opening and without the deal changing stage

#### Scenario: Clear the close date from the card

- **WHEN** an agent clears the expected close date on a deal's board card
- **THEN** the card shows no close date and the cleared value is persisted as
  "not set"

#### Scenario: Archive from the card requires confirmation

- **WHEN** an agent activates the archive action on a deal's board card and
  confirms the prompt
- **THEN** the deal is archived and the card is removed from the board; if the
  agent dismisses the prompt, nothing changes

#### Scenario: Failed persist reverts

- **WHEN** an inline edit or an archive from the card cannot be persisted
- **THEN** the card reverts to the previous title, value, close date, or
  archived state and an error is shown

#### Scenario: Read-only member

- **WHEN** a member without send permission views the board
- **THEN** deal cards offer no inline editing, close-date, or archive
  affordance

### Requirement: A deal can be archived

A deal SHALL carry an **archived** state that is independent of its `open` /
`won` / `lost` status. A deal SHALL default to not archived.

A member with send permission SHALL be able to archive a deal and to unarchive
it. Archiving SHALL change only the archived state: the deal's title, value,
currency, stage, pipeline, status, assignee, custom field values, notes, and
creation history SHALL be preserved. Unarchiving SHALL return the deal to its
existing stage and pipeline.

An archived deal SHALL NOT appear on the pipeline board and SHALL NOT be
included in any stage's deal count or value total, nor in the board analytics.
While a custom field filter is active, its per-stage counts and totals SHALL
also exclude archived deals.

The system SHALL provide a way to review the archived deals of a pipeline and
to unarchive one from there. Archiving and unarchiving SHALL be reflected on
the board without a reload; a failed persist SHALL leave the deal in its
previous state and surface an error.

#### Scenario: Archiving removes the deal from the board

- **WHEN** an agent archives a deal that is showing in a stage column
- **THEN** the card is removed from the board immediately, the change is
  persisted, and the deal is not shown again on the board until it is
  unarchived

#### Scenario: Counts and totals exclude archived deals

- **WHEN** a stage column shows a deal count and value total and one of its
  deals is archived
- **THEN** the count drops by one and the total drops by that deal's value,
  and the board analytics reflect the reduced set

#### Scenario: Archived state is independent of won/lost

- **WHEN** an agent archives a deal whose status is `won`
- **THEN** the deal is archived and its status stays `won`; unarchiving it
  later restores it to the board with status still `won`

#### Scenario: Review and restore an archived deal

- **WHEN** an agent opens the pipeline's archived-deals view and unarchives a
  deal
- **THEN** the deal appears again on the board at its existing stage and is
  counted again in that stage's count and total

#### Scenario: Archiving preserves the deal

- **WHEN** a deal with a value, custom field values, notes, and an assignee is
  archived and then unarchived
- **THEN** the deal keeps the same identifier and all of those fields unchanged

#### Scenario: Failed archive persist is surfaced

- **WHEN** an archive or unarchive cannot be persisted
- **THEN** the deal returns to its previous archived state on the board and an
  error is shown

#### Scenario: Read-only member

- **WHEN** a member without send permission views the board or a deal
- **THEN** the archived state is visible but no archive or unarchive affordance
  is offered

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

### Requirement: Mark a lead as a reportable conversion from the board card

A deal SHALL carry a **conversion mark**, recording that an operator decided
this lead is worth reporting to the clinic's ad platform. The mark SHALL be
independent of the deal's `open` / `qualified` / `lost` status, of its stage,
and of its archived state: none of those SHALL set, clear, or be changed by it.
A deal SHALL default to unmarked.

A member with send permission SHALL be able to set and clear the mark directly
on the deal's pipeline board card, without opening the deal detail view. The
card SHALL show whether the deal is marked, distinguishably from the status
badge it already shows, so that a qualified-but-unmarked deal and a marked deal
are never confused for one another.

The affordance SHALL be offered only on cards whose contact arrived from an ad
click, because for any other lead there is nothing that could be reported.

The card SHALL update immediately on commit and the mark SHALL be persisted; a
failed persist SHALL revert the card and surface an error. Setting or clearing
the mark SHALL NOT move the deal between stages and SHALL NOT interfere with
dragging the card.

A member without send permission SHALL see the mark's state but SHALL NOT be
offered the control.

#### Scenario: Mark from the card

- **WHEN** an agent activates the conversion mark on the board card of a deal
  whose contact came from an ad
- **THEN** the card shows the deal as marked immediately, the mark is persisted,
  and the deal's status and stage are unchanged

#### Scenario: Unmark from the card

- **WHEN** an agent clears the conversion mark on a board card
- **THEN** the card shows the deal as unmarked immediately and the cleared mark
  is persisted

#### Scenario: Marking is not qualifying

- **WHEN** an agent qualifies a deal from the deal detail view
- **THEN** the deal's conversion mark is unchanged, and marking a deal on the
  card likewise leaves its status unchanged

#### Scenario: Organic lead offers no control

- **WHEN** an agent views the board card of a deal whose contact did not arrive
  from an ad
- **THEN** no conversion mark control is offered on that card

#### Scenario: Failed persist reverts

- **WHEN** a conversion mark set or cleared from the card cannot be persisted
- **THEN** the card reverts to the previous mark state and an error is shown

#### Scenario: Read-only member

- **WHEN** a member without send permission views the board
- **THEN** deal cards offer no conversion mark control
