## ADDED Requirements

### Requirement: The account page states the clinic's specialty

The account page SHALL show the specialty recorded when the account was
provisioned, among the facts the system knows about the account. When the
specialty is "Outros", the page SHALL show the free text the operator typed
rather than the word "Outros" alone.

An account provisioned before the specialty was recorded SHALL be shown as
having none, stated plainly, rather than as a blank or a fabricated default.

The page SHALL NOT present the specialty as something that configures the
account: it describes the clinic and drives nothing.

#### Scenario: A listed specialty is shown

- **WHEN** an operator opens an account provisioned as "fisioterapeuta"
- **THEN** the page shows that specialty

#### Scenario: "Outros" shows its free text

- **WHEN** an operator opens an account provisioned as "Outros" with the text
  "quiropraxia"
- **THEN** the page shows "quiropraxia" as the clinic's niche

#### Scenario: An older account has none

- **WHEN** an operator opens an account provisioned before specialties were
  recorded
- **THEN** the page states that no specialty is recorded, and shows no default
