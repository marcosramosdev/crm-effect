# Feature Availability Specification

## Purpose

Governs which in-progress product areas are exposed to operators, so that
features whose implementation is incomplete can stay in the codebase without
being reachable in the running product.

## Requirements

### Requirement: Incomplete features are gated behind a single switch

The system SHALL treat Broadcasts, Automations, Flows, and AI Agents as
incomplete features that are hidden from operators by default. Their
availability SHALL be controlled by one build-time configuration switch that
covers all four together; the switch SHALL default to "off" so a deployment
that sets nothing exposes none of them. The feature code — pages, components,
API routes, and specifications — SHALL remain in the repository regardless of
the switch.

#### Scenario: Default deployment hides all four features

- **WHEN** the application runs with the incomplete-features switch unset
- **THEN** Broadcasts, Automations, Flows, and AI Agents are absent from every
  operator-facing surface and none of their routes render

#### Scenario: Switch re-enables the whole set

- **WHEN** a deployment turns the incomplete-features switch on
- **THEN** all four features become reachable again with no other configuration
  change

### Requirement: No operator entry points to gated features

While the incomplete-features switch is off, the system SHALL NOT present any
navigable path to Broadcasts, Automations, Flows, or AI Agents from operator
chrome. This includes the primary navigation sidebar, dashboard quick actions
and shortcuts, header page-title handling, and any in-app menu or link that
targets those areas.

#### Scenario: Sidebar omits gated features

- **WHEN** an operator views the navigation sidebar with the switch off
- **THEN** there are no Broadcasts, Automations, Flows, or AI Agents entries

#### Scenario: Dashboard shortcuts omit gated features

- **WHEN** an operator views the dashboard quick actions with the switch off
- **THEN** no quick action links to Broadcasts or Automations, and the
  remaining quick actions still function

### Requirement: Direct navigation to a gated route is refused

While the incomplete-features switch is off, the system SHALL redirect any
request for `/broadcasts`, `/automations`, `/flows`, `/agents`, or any path
nested under them, to the dashboard, so that typing or bookmarking the URL does
not reach the feature.

#### Scenario: Operator types a gated URL

- **WHEN** an authenticated operator navigates directly to `/broadcasts` (or a
  nested path such as `/broadcasts/new`) with the switch off
- **THEN** the system redirects them to `/dashboard` and the broadcast UI never
  renders

#### Scenario: Gated route is reachable again when enabled

- **WHEN** the switch is on and an operator navigates to `/automations`
- **THEN** the automations page renders normally with no redirect
