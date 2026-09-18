## Why

The operator console is the only place Effect can see whether a clinic it just
provisioned is actually working, and today it shows almost nothing. It lists an
account's Meta configuration and two conversion counters, and nothing else: not
whether the client ever scanned the QR code, not whether the dataset identifier
that was pasted into the form is real, not what happened to any individual
conversion. `docs/runbook-cliente-novo.md` covers the gap with twelve manual
checklist items, several of which the system already knows the answer to.

Two of those gaps cost money silently. A clinic whose WhatsApp was never
connected loses the ad click of every message that arrives before the scan, and
nobody finds out. A mistyped dataset identifier or a token generated under the
wrong Business Manager produces no error at configuration time — the first
symptom is conversions piling up undelivered, or never being delivered at all.

## What Changes

- `/admin` becomes an account list: one row per clinic with its WhatsApp
  connection state and paired number, its advertising configuration state, and
  its conversion counters. The current expanding configuration panel moves out of
  the list.
- Each account gets its own page at `/admin/accounts/[id]`: the advertising
  configuration form, the derived setup state, the static reminder of the
  checklist items the system cannot know, and the account's recent conversions.
- A **validate** action next to the advertising credentials calls Meta with the
  values currently in the form — before they are saved — and reports whether the
  token can see the dataset. Bad token and mismatched Business Manager are
  reported in the operator's own words; any other failure shows Meta's message
  verbatim. Nothing about the result is stored.
- The conversion counters cover every delivery state the outbox can hold, not
  just the two that exist before conversions are ever sent.
- Each account's conversions become inspectable: the most recent ones, with the
  contact's name, the delivery state, when the conversion was recorded, how many
  delivery attempts it took and the last error. No phone number, no click
  identifier.
- The provisioning form accepts the Page identifier and the conversion event
  name, so a new account leaves the form fully configured instead of needing a
  second visit to the edit surface on the same day.
- The setup checklist text stops telling operators to qualify a lead: since
  migration 049 what records a conversion is the mark on the deal's card.

## Capabilities

### New Capabilities

- `admin-console`: what a platform operator can see and do about the accounts
  Effect runs — the account list and its health signals, the per-account page,
  validating advertising credentials against Meta, and inspecting an account's
  recorded conversions.

### Modified Capabilities

<!-- None. The advertising configuration requirements that this console renders
     already live in the `provisioning` delta of `meta-capi-qualified-lead`
     (operator-only edit surface, optional-at-provisioning fields, setup
     procedure, test-mode warning). This change adds the console's own
     requirements rather than restating or re-deltaing those. -->

## Impact

- **New**: `src/app/admin/accounts/[id]/page.tsx`, `src/lib/meta/graph.ts` (the
  first Graph API call in the repository — the conversion sender of
  `meta-capi-qualified-lead` task 8.1 is expected to reuse it),
  `POST /api/admin/accounts/[id]/meta/validate`.
- **Changed**: `src/app/admin/page.tsx` (account list, connection join, full
  counters), `src/components/admin/meta-accounts-panel.tsx` (splits into the list
  row and the per-account form), `src/components/admin/provisioning-form.tsx` and
  `src/lib/provisioning/provision.ts` (two more optional fields), the event-name
  validation shared with `PATCH /api/admin/accounts/[id]/meta`,
  `messages/pt-BR.json` and `messages/en.json`.
- **Reads**: `whatsapp_config.connection_state`, `paired_phone`, `paired_at`
  (migration 040) and `meta_capi_events` (migrations 048/049). No schema change.
- **Outbound**: one Meta Graph request per validate click, made from the server
  with the operator's supplied token. No client ever sees the token.
- **Out of scope**: the conversion sender itself (blocked on the D0 experiment,
  task 8.1 of `meta-capi-qualified-lead`), suspending or deleting an account,
  any password handling after provisioning, a checklist whose manual items can be
  ticked and stored, and persisting validation results on the account.
