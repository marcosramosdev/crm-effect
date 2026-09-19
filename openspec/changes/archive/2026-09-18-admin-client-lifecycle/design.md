## Context

See proposal.md — Why. What the design has to work with:

- `provision()` (`src/lib/provisioning/provision.ts`) takes seven required
  inputs and runs seven ordered steps with a rollback. `auth.admin.createUser`
  fires the `handle_new_user` trigger (migration 017), which creates the
  `accounts` row; step 3 renames it. Nothing in the orchestrator is optional
  today except the Meta fields.
- `POST /api/admin/provision` validates the body with `requiredString()` on
  clinic name, client name, e-mail, specialty, and rejects a missing one before
  `provision()` runs.
- `SPECIALTY_TEMPLATES` (`src/lib/provisioning/templates.ts`) holds three
  templates — dentist, physician, psychologist — each a stage list whose first
  entry is the system stage.
- `getCurrentAccount()` (`src/lib/auth/account.ts`) is the one server-side
  chokepoint for account context: it reads the caller's profile, then the
  `accounts` row with `select("id, name")`. 37 files import this module. The
  WhatsApp webhook deliberately does **not** go through it — it runs under the
  service-role client so inbound messages never depend on a user session.
- `src/middleware.ts` makes no database query at all. It calls
  `supabase.auth.getUser()` and routes on the path. `/admin` is gated there by
  `isPlatformAdmin`; `/api/admin/*` is not, and each route re-checks.
- `(dashboard)/layout.tsx` is a synchronous server component that renders a
  client shell; it performs no auth work.
- Under `/api/admin/accounts/[id]` only `meta/` and `meta/validate/` exist.
  There is no route for the account row itself.
- `meta_capi_events` rows are enqueued by a database trigger on
  `deals.meta_qualified_at` (migration 049). The sender that would deliver them
  does not exist yet, so `pending` and `unconfigured` are the only states
  anything writes.

## Goals / Non-Goals

**Goals:**

- Creating an account costs an operator two fields and one click.
- Deactivation is enforced in one place that every authenticated read already
  passes through, at zero extra database round trips.
- A deactivated account can be reactivated into exactly the state it left.

**Non-Goals:**

- No permanent deletion, no purge job, no data export.
- No change to how the Meta dataset and token are edited or validated.
- No per-member suspension. The unit of deactivation is the account.
- No change to the WhatsApp gateway instance on deactivation: inbound traffic
  keeps arriving and being stored, which is what makes reactivation lossless.

## Decisions

### D1 — `accounts.deactivated_at`, a nullable timestamp

Migration 050 adds `accounts.deactivated_at TIMESTAMPTZ NULL`. `NULL` means
active, so every existing row is active with no backfill. A timestamp rather
than a boolean because the console has to show *when* an account was taken out
of service, and a boolean plus a separate date column is two columns that can
disagree.

The column stays readable only to the service-role client, like the Meta
credentials (migration 046 revoked `SELECT ON accounts` from `authenticated`
for those columns) — except that `getCurrentAccount()` must read it under the
caller's own session. So it is granted to `authenticated` like `id` and `name`:
a client learning that their own account is deactivated is exactly what D2
shows them.

### D2 — One enforcement point: the `accounts` read inside `getCurrentAccount()`

`getCurrentAccount()` already fetches the account row. Widening its select to
`id, name, deactivated_at` and throwing when the value is non-null enforces
deactivation across all 37 importers — every `/api/*` route and every server
component that resolves account context — for zero extra queries.

The throw is a new `AccountSuspendedError` (status 403) rather than a reused
`ForbiddenError`, so the browser can tell "you lack the role" from "this
account is suspended" and show the right message. `toErrorResponse()` maps it.

Alternatives considered:

- **Ban the members' auth users** via `auth.admin.updateUserById({ ban_duration })`.
  Rejected: two sources of truth (auth.users and accounts) that drift the
  moment a member is invited to a deactivated account, the roster still needs
  the column for display, and an unexpired access token keeps working anyway.
- **An RLS policy hiding deactivated accounts.** Rejected: every query silently
  returns empty and the client sees a product that lost their data, with no way
  to say why.
- **A check in `src/middleware.ts`.** Rejected: middleware runs on every request
  and makes no database query today; adding one buys a redirect that D3 gets
  from a single server component.

### D3 — Sign-in is refused by turning the session away, not by the auth server

Supabase authenticates against `auth.users`; nothing there knows about account
deactivation (D2's rejected alternative). So the password check still succeeds
and the redirect to `/dashboard` is where the refusal happens:
`(dashboard)/layout.tsx` becomes an async server component that calls
`getCurrentAccount()`, and on `AccountSuspendedError` signs the session out and
redirects to `/login?suspended=1`, where the login page renders the suspension
notice.

Signing out matters: a suspended session left alive would keep hitting APIs
that each answer 403, which reads as a broken product rather than a suspension.
The same path covers a member whose account is deactivated mid-session — their
next navigation is turned away, and their next API call is already 403 from D2.

### D4 — Deactivation cancels the account's undelivered conversions

Deactivating moves that account's `meta_capi_events` rows in `pending` and
`unconfigured` to `canceled`, the state migration 049 already defines for an
unmarked conversion. A Click is only an attribution key to Meta for seven days;
an account that comes back in three weeks would otherwise deliver a batch of
conversions Meta rejects. Reactivation does not revive them.

The sender does not exist yet, so nothing is delivered for a deactivated
account today in any case. When it is written it must also filter
`deactivated_at IS NULL`; that belongs to the sender's own change, and this
change leaves the constraint stated on the column.

### D5 — Two operator routes, not four

- `PATCH /api/admin/accounts/[id]` — the account row itself: `{ name? }` and
  `{ deactivated?: boolean }`. One route because both write one row and share
  the same allow-list re-check, and because the console's per-account page
  already has a form shape for this.
- `POST /api/admin/accounts/[id]/password` — separate, because it writes to
  `auth.users` through the service-role admin client, never echoes the value
  back, and must invalidate the owner's sessions. Keeping it apart is what
  makes "no route that writes an account ever handles a password" readable at a
  glance.

Both re-check `isPlatformAdmin` in the route (middleware covers `/admin`, not
`/api/admin`), matching the existing `meta` routes.

Session invalidation after a password change: `auth.admin.updateUserById` with
a new password already revokes the user's refresh tokens in Supabase, so the
old session dies at its next refresh. Where an immediate cut is needed,
deactivation is the tool; a password reissue is not a security event.

### D6 — Optional inputs resolve inside `provision()`, not at the edge

`ProvisionInput` keeps its shape but every field except `clientEmail`,
`clientPassword` and `specialty` becomes optional. The defaults resolve in one
place at the top of `provision()`:

- `clinicName` → the local part of `clientEmail` (`cliente1@effect.com` →
  `cliente1`), so the roster never shows a nameless row;
- `clientFullName` → the same fallback, since it only feeds
  `user_metadata.full_name`;
- `persona` → empty string, which `ai_configs` already accepts;
- `specialty` → `"dentist"` when absent.

The route keeps validating what it validates today (duplicate address, password
length, event name) and stops rejecting the now-optional fields. Resolving in
`provision()` rather than in the route means a second caller — a seeding script,
a test — gets the same defaults.

### D7 — Two templates, reworked

`SPECIALTY_TEMPLATES` drops `psychologist` and keeps `dentist` and
`physician`, both revisited so the stages read like the two funnels the agency
actually implements. The set is the form's whole vocabulary, so the operator
picks one of two rather than scanning a list that includes a specialty nobody
sells to. Existing accounts are unaffected: a template is read once, at
creation.

Assumption, from the answers to the proposal's questions: the agency wants
exactly these two. A third is a one-line addition to the same table.

### D8 — The form is two fields plus one disclosure

`provisioning-form.tsx` keeps every field it has. E-mail, password and the
specialty select stay in view; clinic name, client name, persona and the four
advertising fields move into one collapsed `<details>`-style section labelled as
optional. Nothing is removed, so an operator who does have the clinic's details
at hand still enters them in one pass — which is what the "all optional"
decision asked for.

### D9 — The roster splits in the server component, not in a second query

`src/app/admin/page.tsx` adds `deactivated_at` to its existing `accounts`
select and partitions the rows in memory. Deactivated accounts render in their
own section below the active ones, each with the date it was deactivated. One
query, same shape as today.

## Risks / Trade-offs

- **A suspended member sees the notice one navigation late.** → D3 signs the
  session out on that navigation, and every API call is already refused by D2
  in the meantime, so nothing is readable in between.
- **A deactivated account keeps its gateway instance, and whatever that costs.**
  → Accepted deliberately: dropping the instance is what would make
  reactivation lossy. If cost becomes the issue, disconnecting the instance is
  a later change with its own decision about the lost traffic.
- **`getCurrentAccount()` is the only chokepoint, and the webhook bypasses it.**
  → Intended: inbound messages must keep being stored for a deactivated
  account. Any *future* service-role path that acts on a client's behalf has to
  check the column itself; D4 states the same for the sender.
- **The account name can now come from an e-mail address.** → An operator can
  correct it from the console at any time, which is one of this change's own
  additions.
- **Deactivation cancels conversions that reactivation will not bring back.** →
  Stated in the spec, and shown in the confirmation the console asks for.

## Migration Plan

1. Apply `supabase/migrations/050_account_deactivation.sql` by hand in the
   Supabase SQL editor, as every migration in this project is applied. It is
   idempotent and adds one nullable column plus the grant — no backfill, no
   lock of consequence.
2. Deploy. Every existing account has `deactivated_at IS NULL` and behaves
   exactly as before.
3. Rollback: the column can be left in place; reverting the application code
   restores previous behaviour because a `NULL` column changes nothing. Undoing
   a deactivation performed in the meantime is a `PATCH` in the console, or one
   `UPDATE accounts SET deactivated_at = NULL`.
