## Context

See proposal.md — Why. What the design has to work with:

- `/admin` is a server component reading through the service-role client
  (`src/app/admin/page.tsx`), because an operator holds no membership in the
  accounts it lists and every account-scoped RLS policy is membership-based.
  `src/middleware.ts:110` guards every path under `/admin`; `/api/admin/*` is
  **not** covered by it and each route re-checks `isPlatformAdmin` itself.
- `whatsapp_config` has `account_id` UNIQUE NOT NULL (migration 017) and carries
  `connection_state`, `paired_phone`, `paired_at` (migration 040). The webhook
  writes `connection_state` on every gateway callback
  (`src/app/api/whatsapp/webhook/[secret]/route.ts:363`), so the stored value
  tracks the gateway without anyone polling.
- `meta_capi_events` already holds `status`, `event_time`, `attempts`,
  `last_error`, `sent_at`, `contact_id` (migration 048) and `canceled` in its
  status check (migration 049, applied). Nothing new is needed from the schema.
- There is no `src/lib/meta/` and no call to `graph.facebook.com` anywhere in
  the repository. The validate action is the first one.
- The conversion sender is still blocked on the D0 experiment
  (`meta-capi-qualified-lead` tasks 4.1–4.5), so `sent`, `failed` and `expired`
  are states nothing writes yet.

## Goals / Non-Goals

**Goals:**

- One read of the console answers "is this clinic working?" without opening
  anything or leaving the page.
- A credential typo is caught while the operator is still looking at the form,
  not weeks later.
- Delivery states light up by themselves the day the sender starts writing them,
  with no further console work.

**Non-Goals:**

- No schema change, no migration. Everything rendered already exists in the
  database.
- No live gateway probe, no background job, no polling.
- No pipeline, inbox or contact data from the client's account beyond the
  contact name on a conversion row.

## Decisions

### D1 — Two surfaces: a list at `/admin`, a page per account

`/admin` keeps the provisioning form and gains an account list: name, connection
state, advertising state badges, counters. Each row links to
`/admin/accounts/[id]`, a new server component carrying the configuration form,
the derived setup state, the static reminders and the conversions table.

Alternative considered: keep everything in today's expanding row
(`meta-accounts-panel.tsx`). Rejected — the row would have to hold a six-field
form, a validate action, a checklist and a 50-row table, and the list stops
being scannable at the first expansion. `/admin` guarded by prefix in
`src/middleware.ts:110` means the new page needs no separate guard.

### D2 — Connection state comes from the column, never from the gateway

The list joins `whatsapp_config` on `account_id` and renders
`connection_state` / `paired_phone` / `paired_at` as stored.

Alternative considered: `GET /instance/status` per account at render time. That
is N outbound HTTP calls to UAZAPI to draw one list, it makes the console as slow
and as available as the gateway, and it buys freshness the callback already
provides.

### D3 — Counters by reading statuses and counting in the process

One `select account_id, status from meta_capi_events` for the whole list, one for
the single account's page, counted into a map. supabase-js has no `GROUP BY`, and
the alternatives are worse for now: a `count` query per account per status is
`accounts × states` round trips, and an RPC means a migration for a number that
is still in the hundreds.

```
// ponytail: counts rows client-side; move to an RPC doing GROUP BY
// if meta_capi_events passes ~10k rows.
```

The render rule from the spec — always show waiting and unreportable, show the
rest only when non-zero — is what makes the sender's first delivery failure
appear without touching this code again.

### D4 — Validate checks what is in the form, over a POST, on the server

`POST /api/admin/accounts/[id]/meta/validate`, body `{ metaDatasetId,
metaAccessToken? }`, re-checking `isPlatformAdmin` like the sibling PATCH route.
A blank token falls back to the account's stored one, decrypted server-side —
the same "blank means leave it alone" rule the PATCH route already applies
(`route.ts`, tasks 5.4 of the sibling change), so the two surfaces cannot
disagree about what blank means.

The call is `GET https://graph.facebook.com/<version>/<datasetId>?fields=id,name,owner_business`
with the token as a bearer credential, wrapped in
`AbortSignal.timeout(10_000)`.

A POST rather than a GET because the token travels in the body: a GET would put a
live credential in a URL, and from there into every access log between here and
Meta.

The dataset identifier is URL-encoded into a path segment of a constant host.
There is no operator-supplied host, so this is not an outbound-request surface an
operator could aim anywhere.

### D5 — `src/lib/meta/graph.ts` holds the version and the error shape

One module: the Graph version constant, the fetch wrapper, and a pure classifier
mapping Meta's error body onto the console's three cases — `code 190` → dead
token, `code 100` with `error_subcode 33` / `#803` in the message → token and
dataset under different business managers, anything else → pass `error.message`
through. Network failure and timeout are a fourth, distinct outcome: not a
rejection, an unfinished check.

The classifier is pure and is the one piece here with a runnable check, over
recorded Meta error bodies. The sender of `meta-capi-qualified-lead` task 8.1
posts to the same host with the same version and the same error vocabulary, so it
reuses this module rather than growing a second copy of the version string.

### D6 — Nothing about validation is persisted

No `meta_validated_at`, no `meta_validation_error`, no migration. Events Manager
tokens die with the access of whoever generated them (runbook §8), so "validated
40 days ago" is a claim the system cannot stand behind. The result lives in the
response and in the operator's eyes.

### D7 — The conversions table is server-rendered, filtered in the browser

The 50 most recent rows for the account by `created_at desc`, joined to
`contacts(name)`, rendered by the server component. The state filter runs in the
browser over those rows: 50 rows already in memory do not need a round trip, and
a filter that re-queries would also re-window and quietly show a different 50.

### D8 — The privacy rule is enforced by the query, not by the template

The select list for the conversions table names its columns explicitly and
includes neither `ctwa_clid` nor `contacts.phone`. Same discipline as
`hasAccessToken` in today's panel: the value that must not reach the browser is
not fetched in the first place, so no later template change can leak it.
`last_error` is truncated for display only.

### D9 — `meta-accounts-panel.tsx` splits along the new seam

Its row-state classifier (`classifyAccountMetaStatus`, already pure and already
tested) stays and grows into the list row. Its form moves to the account page as
its own component. The derived setup state of the spec's checklist requirement is
a second pure function beside it, tested the same way — no component-rendering
harness, which this repository does not otherwise have.

### D10 — Event-name validation becomes one shared module

`EVENT_NAME_RE` and its rejection message move out of the PATCH route into a
module the PATCH route, the provisioning input and the provisioning form all
import. Two copies of a regex that must agree between the create form and the
edit form is exactly the divergence the spec's "rejected in both places" scenario
is there to catch.

### D11 — The checklist splits by who can know

Derived state — connected, dataset and token present, test code set, any contact
with a click, any conversion recorded — comes from data already loaded for the
page. The three the system cannot know (dataset shared with the client's ad
account, campaign live with a matching performance goal, credentials delivered)
are localized static text. No table, no tick boxes: a stored tick on "the
campaign optimizes for the right event" records that someone clicked, not that
the campaign is right.

## Risks / Trade-offs

- **Counting rows in the process scales badly** → bounded by the ponytail note in
  D3; the console reads at most one status column per event row and the move to
  an RPC is local to one function.
- **A slow or unreachable Meta blocks the operator for up to 10 seconds** → the
  timeout is bounded and the outcome is reported as an unfinished check, so the
  operator never reads "unreachable" as "credentials rejected".
- **Service-role reads bypass RLS on the account page** → mitigated by explicit
  select lists (D8); the review point for this change is the column list of every
  query, not the JSX.
- **Three delivery states render as absent until the sender exists** → deliberate
  (D3). The alternative, showing `sent: 0` and `failed: 0` forever, trains the
  operator to read zeros as normal right up to the day one of them stops being
  zero.
- **The Graph version is pinned in one constant** → when Meta retires `v23.0` the
  validate action starts failing with Meta's own message, which D5 passes through
  verbatim. That is the intended failure mode: visible, and naming its own cause.

## Migration Plan

No database migration. The change is application code plus message catalogs, so
deployment is a normal release and rollback is a revert — no data is written that
a rollback would strand.

Migration 049 is already applied, which is what makes `canceled` a state the
counters can legitimately render.
