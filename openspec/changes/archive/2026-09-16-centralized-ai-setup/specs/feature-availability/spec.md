## ADDED Requirements

### Requirement: Unfinished features are gated behind a single switch

The system SHALL treat Broadcasts, Automations, and Flows as incomplete
features that are hidden from operators by default. Their availability SHALL be
controlled by one build-time configuration switch that covers all three
together; the switch SHALL default to "off" so a deployment that sets nothing
exposes none of them. The feature code — pages, components, API routes, and
specifications — SHALL remain in the repository regardless of the switch.

The AI assistant SHALL NOT be part of this set. No value of the
incomplete-features switch SHALL affect whether the assistant is available.

#### Scenario: Default deployment hides the three gated features

- **WHEN** the application runs with the incomplete-features switch unset
- **THEN** Broadcasts, Automations, and Flows are absent from every
  operator-facing surface and none of their routes render

#### Scenario: Switch re-enables the whole set

- **WHEN** a deployment turns the incomplete-features switch on
- **THEN** all three features become reachable again with no other
  configuration change

#### Scenario: The AI assistant is unaffected by the switch

- **WHEN** the application runs with the incomplete-features switch unset, and
  again with it on
- **THEN** the AI assistant is reachable in both cases and its presence in the
  navigation is identical

## MODIFIED Requirements

### Requirement: No operator entry points to gated features

While the incomplete-features switch is off, the system SHALL NOT present any
navigable path to Broadcasts, Automations, or Flows from operator chrome. This
includes the primary navigation sidebar, dashboard quick actions and shortcuts,
header page-title handling, and any in-app menu or link that targets those
areas.

The AI assistant SHALL be presented in operator chrome — sidebar entry and
header title — regardless of the switch.

#### Scenario: Sidebar omits gated features

- **WHEN** an operator views the navigation sidebar with the switch off
- **THEN** there are no Broadcasts, Automations, or Flows entries, and the AI
  assistant entry is present

#### Scenario: Dashboard shortcuts omit gated features

- **WHEN** an operator views the dashboard quick actions with the switch off
- **THEN** no quick action links to Broadcasts or Automations, and the
  remaining quick actions still function

### Requirement: Direct navigation to a gated route is refused

While the incomplete-features switch is off, the system SHALL redirect any
request for `/broadcasts`, `/automations`, `/flows`, or any path nested under
them, to the dashboard, so that typing or bookmarking the URL does not reach
the feature. `/agents` SHALL NOT be redirected under any value of the switch.

#### Scenario: Operator types a gated URL

- **WHEN** an authenticated operator navigates directly to `/broadcasts` (or a
  nested path such as `/broadcasts/new`) with the switch off
- **THEN** the system redirects them to `/dashboard` and the broadcast UI never
  renders

#### Scenario: Gated route is reachable again when enabled

- **WHEN** the switch is on and an operator navigates to `/automations`
- **THEN** the automations page renders normally with no redirect

#### Scenario: The assistant route is never redirected

- **WHEN** an authenticated operator navigates directly to `/agents` with the
  switch off
- **THEN** the AI assistant page renders with no redirect

## REMOVED Requirements

### Requirement: Incomplete features are gated behind a single switch

**Reason**: The gated set shrank from four features to three — the AI assistant
leaves it and is always available. Restated as "Unfinished features are gated
behind a single switch" above, which drops AI Agents and states the exclusion
explicitly.

**Migration**: None. `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED` keeps its name
and its meaning for the three remaining features; a deployment that already
sets it needs no change.
