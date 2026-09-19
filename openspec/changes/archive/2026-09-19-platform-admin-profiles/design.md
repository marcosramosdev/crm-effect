## Context

See proposal.md — Why. What the design has to work with:

- `isPlatformAdmin(email)` (`src/lib/provisioning/platform-admins.ts`) is a
  synchronous string comparison against `PLATFORM_ADMINS`. Seven call sites:
  `src/middleware.ts` gates `/admin`, and the five routes under
  `/api/admin/*` each re-check it because middleware does not cover
  `/api/admin`.
- `src/middleware.ts` makes no database query. It calls
  `supabase.auth.getUser()` under the caller's session — Edge runtime, anon
  key, no service-role key available — and routes on the path. It already
  redirects `/`, `/login`, `/signup` and `/forgot-password` to `/dashboard`
  for a signed-in visitor.
- `handle_new_user` (migration 017) fires on every `auth.users` insert and
  creates an `accounts` row plus a `profiles` row with `account_role = 'owner'`
  for the new identity. Every operator who has ever signed in therefore already
  owns an account, which is why `/admin` works today without an operator being
  anyone's member — and why the roster lists those accounts.
- `getCurrentAccount()` (`src/lib/auth/account.ts`) resolves the caller's
  profile and account and throws `AccountSuspendedError` for a deactivated
  account. 37 files import it.
- `(dashboard)/layout.tsx` is already an async server component that calls
  `getCurrentAccount()` and redirects on suspension; it renders
  `DashboardShell`, which mounts the sidebar, the header, the password banner
  and the connection provider.
- `/admin` has no layout of its own: `src/app/admin/page.tsx` and
  `admin/accounts/[id]/page.tsx` render bare, and the only sign-out controls
  in the product live in the client sidebar and header.
- `provision()` and `POST /api/admin/accounts/[id]/password` already create and
  update sign-in identities through the service-role client
  (`src/lib/provisioning/admin-client.ts`), with `email_confirm: true` and no
  e-mail sent.

## Goals / Non-Goals

**Goals:**

- Adding or removing an operator is a console action, not a redeploy.
- The check that a deployment cannot lock itself out survives a database that
  is unreachable.
- No client surface ever renders for an operator, enforced server-side, with no
  per-navigation database query added to the paths users actually walk.
- The smallest possible change to the seven existing authorization call sites.

**Non-Goals:**

- No change to `handle_new_user`, to `getCurrentAccount()`, or to the account
  model. An operator remains an ordinary sign-in identity to the database.
- No editing of an operator's role, no deletion of their sign-in identity, no
  second seeding mechanism.
- No audit trail beyond who registered whom and when.

## Decisions

### D1 — `platform_operators`, keyed to the sign-in identity

Migration 051 creates:

```
platform_operators (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL UNIQUE,        -- stored lower-cased
  full_name  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('manager','admin')),
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

Keyed on `user_id` rather than on the address because the authorization check
runs in Edge middleware under the caller's own session, where the only identity
available to a policy is `auth.uid()`; keying on the address would force a
lookup through `auth.users`, which PostgREST does not expose. The address is
carried anyway — it is what the environment seed matches on, and what the
register displays.

`ON DELETE CASCADE` on `user_id`: if a sign-in identity is ever deleted by hand
in Supabase, an operator record pointing at nothing would be an access grant
with no owner. `created_by` is `ON DELETE SET NULL` instead, because losing the
registrar must not lose the operator.

`role` is a `CHECK` rather than a new enum type: `account_role_enum` already
owns the value `'admin'` with an entirely different meaning (a role inside a
client account), and two enum types whose values overlap invite the wrong one
being used. A `CHECK` keeps the two vocabularies visibly separate.

### D2 — One RLS policy: an operator may read their own row

RLS is enabled with a single policy, `SELECT USING (user_id = auth.uid())`. No
`INSERT`, `UPDATE` or `DELETE` policy exists, so every write goes through the
service-role client, as the rest of the operator surface already does.

That single read is what the middleware needs and all it needs: resolving the
caller's own role. A non-operator's query returns no rows, so the table cannot
be enumerated from a client session — which is the spec's "a client session
cannot read the operator records".

Alternatives considered:

- **Service-role read in middleware.** Rejected: it would put the service-role
  key in the Edge runtime for every request on the matcher, to answer a
  question about the caller themselves.
- **Role in the JWT via a custom access-token hook.** Rejected: a stale claim
  survives until the token refreshes, so a removed operator would keep the
  console for minutes. Every operator check in this project is deliberately a
  fresh server-side check.

### D3 — `resolvePlatformOperator(user)` replaces `isPlatformAdmin(email)`

`src/lib/provisioning/platform-admins.ts` gains an async
`resolvePlatformOperator(client, user)` returning `{ role: "manager" | "admin",
seeded: boolean }` or `null`, and the seven call sites become `await`ed. Order
matters:

1. the environment seed is checked first, synchronously, with no query — an
   address in `PLATFORM_ADMINS` is a manager;
2. otherwise the caller's own `platform_operators` row is read.

Checking the seed first is what makes the lockout guarantee survive a database
outage: the addresses that bootstrap the deployment never depend on a query.
The existing synchronous env comparison stays in the module as the first step,
so nothing about the seed's behaviour changes.

### D4 — Operator-owned accounts are excluded from the roster by owner

`src/app/admin/page.tsx` already reads accounts through the service-role
client. It gains the set of operator user ids — every `platform_operators.user_id`,
plus the `profiles.user_id` of any address in the environment seed — and drops
accounts whose `owner_user_id` is in it. Two small indexed queries, and the
roster query itself is unchanged.

Looking seeded operators up through `profiles` rather than
`auth.admin.listUsers()`: `profiles` mirrors the address, is filterable by
`email IN (…)`, and does not page through every client user of the deployment
to find two addresses.

Alternatives considered:

- **Stop `handle_new_user` creating an account for operator addresses.**
  Rejected: the trigger would have to consult a table that cannot exist yet at
  the moment the identity is created, and existing operators would still own
  the accounts they own today.
- **Delete the account at registration.** Rejected as the more invasive of the
  two options offered; the record is left in place and hidden, which keeps this
  change reversible by reverting code alone.

### D5 — Two routing enforcement points, neither of them per-navigation

- **`src/middleware.ts`** resolves the operator once for the paths that *route*
  people — `/`, `/login`, `/signup`, `/forgot-password` — and sends an operator
  to `/admin` instead of `/dashboard`; and on `/admin*` it gates on the
  resolution it already needs, refusing `/admin/operators` to the admin role.
- **`(dashboard)/layout.tsx`** resolves the operator before it calls
  `getCurrentAccount()` and redirects to `/admin`. This is what covers every
  other client route — `/inbox`, `/contacts`, `/settings` and the rest — and it
  is a server redirect, so `DashboardShell` never renders and no sidebar,
  banner or pending step reaches the browser.

Putting the second check in the layout rather than in middleware keeps the
per-request database queries off the paths a client walks all day: the layout
is already an async server component doing exactly this kind of work, and a
middleware check would run on every request the matcher sees.

The login page needs no change. It performs a full-page navigation to
`/dashboard` (deliberately, issue #365); for an operator the layout turns that
into `/admin` before anything renders.

### D6 — `getCurrentAccount()` is left alone

The initiating request assumed the membership requirement in
`getCurrentAccount()` would have to stop applying to operators. It does not:
`handle_new_user` has already given every operator identity an account of its
own, so the function resolves for them, and D5 guarantees they never reach a
surface that calls it. Loosening it would mean a nullable account context
threaded through 37 importers to serve a session that is redirected away
before any of them runs.

The consequence is stated rather than hidden: an operator owns an account that
nobody uses. D4 keeps it out of the roster.

### D7 — Registration is provisioning's shape, minus the account

`POST /api/admin/operators` re-checks the manager role, then, through the
service-role client: `auth.admin.createUser({ email_confirm: true, password })`,
then insert the `platform_operators` row. If the insert fails, the identity
just created is deleted — the same rollback shape `provision()` uses, and the
same reason: a half-registered operator is worse than a failed registration.

An address that already has an identity and no record is the removed-operator
case (D8), and it is what makes removal reversible: the route inserts the
record against the existing `user_id` and does not touch the password, so no
password is asked for or reported. A duplicate is therefore refused on the
operator record, not on the identity. The route learns which case it is from
the `createUser` rejection rather than by listing users, and resolves the
existing `user_id` from `profiles` by address — the same lookup D4 uses.

The response carries no password. The browser sent it, so it already has the
value to show once; echoing it back would put it in a response body and a
network log for nothing. This matches
`POST /api/admin/accounts/[id]/password`.

The account `handle_new_user` creates for the new identity is left in place
(D4, D6).

### D8 — Removal deletes the record and nothing else

`DELETE /api/admin/operators/[id]` (the id is the `user_id`) re-checks the
manager role, refuses the caller's own id, refuses an address carried by the
environment seed, and deletes the row. The sign-in identity, the profile and
the account it owns survive.

Refusing a seeded address is honesty rather than protection: D3 resolves the
seed before the table, so a deleted row for a seeded address would come back at
the next request. The register marks those entries as seeded and offers no
removal control for them.

Self-removal is refused in the route, not only hidden in the UI, and there is
no role-change surface at all — which is the whole of "no operator can promote
themselves". A manager who must change a role removes and re-registers.

### D9 — `/admin` gets a layout that carries the session

`src/app/admin/layout.tsx` is added: it renders the console chrome — which
operator is signed in, a link to the operator register when they hold the
manager role, and the sign-out control. Sign-out is a small client component
calling `supabase.auth.signOut()` and navigating to `/login`; it does not mount
`AuthProvider`, which exists to resolve an account context an operator has no
use for.

The layout also declares the same `noindex` metadata the dashboard layout
declares.

## Risks / Trade-offs

- **A recorded (non-seeded) operator is locked out while the database is
  unreachable.** → Accepted and deliberate: the seed is checked first and
  needs no query, so the deployment always has a way in. Anything else would
  mean caching authorization, which every operator check here refuses to do.
- **Middleware now queries the database on `/admin*` and on the sign-in
  landings.** → Bounded to those paths by D5; the routes a client walks are
  unaffected.
- **Operator-owned accounts accumulate in the database.** → Hidden from the
  roster by D4 and reachable by nobody, since D5 keeps operators out of client
  surfaces. If they ever need clearing, that is a one-off script, not a
  behaviour.
- **A removed operator keeps a sign-in identity that leads nowhere.** →
  Intended, and D7 makes it the path back: registering that address again
  attaches the role to the identity that is already there, with its password
  untouched.
- **Registering an address that belongs to a client user would make them an
  operator and route them out of their own account.** → Only a manager can do
  it, and removing the record puts them back exactly where they were, since
  removal touches neither the identity nor the account. Not prevented outright:
  the same path is what restores a removed operator.
- **`PLATFORM_ADMINS` now grants the strongest role.** → It already granted
  everything; naming it manager only makes that explicit, and the register
  shows exactly who holds it.

## Migration Plan

1. Apply `supabase/migrations/051_platform_operators.sql` by hand in the
   Supabase SQL editor, as every migration in this project is applied. It
   creates one table and one policy, touches no existing row, and is
   idempotent.
2. Deploy. With no records in the table, every address in `PLATFORM_ADMINS`
   keeps working exactly as before, now as a manager.
3. A manager registers the rest of the team from the console, and
   `PLATFORM_ADMINS` can be narrowed to the one or two addresses that should
   always survive a database outage.
4. Rollback: reverting the application code restores the previous behaviour
   with the table in place and unread — the environment variable was never
   removed. No data migration to undo.
