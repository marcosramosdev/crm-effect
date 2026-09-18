## ADDED Requirements

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
