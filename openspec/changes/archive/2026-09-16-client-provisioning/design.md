## Context

See `proposal.md` — Why. This section only records the parts of the existing
system that shape the approach.

- **Membership is not what the plan assumed.** There is no `account_members`
  table. Migration 017 made membership `profiles.account_id` +
  `profiles.account_role`, with `accounts.owner_user_id` denormalised, and a
  `handle_new_user` trigger on `auth.users` that already creates the account
  and the owner profile on every user insert. Provisioning therefore **adjusts**
  what that trigger produced; it does not insert those rows itself.
- **The trigger swallows its own failures.** `handle_new_user` ends in
  `EXCEPTION WHEN OTHERS THEN RAISE WARNING … RETURN NEW`, so a failed bootstrap
  leaves an auth user with no account and no error anywhere the caller can see.
  Provisioning has to read the profile back and treat "missing" as a failure.
- **UAZAPI provisioning already exists.** `provisionInstance()` in
  `src/lib/whatsapp/instance.ts` calls `POST /instance/create` with
  `UAZAPI_ADMIN_TOKEN` via `uazapiAdminFetch`, encrypts the returned token with
  `encrypt()` (`src/lib/whatsapp/encryption.ts`, AES-256-GCM under
  `ENCRYPTION_KEY`), and writes or updates the account's `whatsapp_config` row.
  It is idempotent per account. No new gateway module is needed.
- **`accounts` is never read with `select("*")`.** Every call site names its
  columns (`use-auth.tsx` reads `id, name, default_currency, timezone`;
  the rest read one or two columns). Column-level privileges can therefore be
  tightened without breaking any existing query.
- **`accounts.owner_user_id` is `ON DELETE RESTRICT`.** Deleting the auth user
  before deleting the account row fails. Rollback order matters.
- **Stage writes are scattered.** `pipeline-settings.tsx` does one `upsert` for
  the whole stage list plus separate `insert`/`delete`; `pipelines/page.tsx`,
  `messaging-panel.tsx` and the automation builder also touch
  `pipeline_stages`. A UI-only guard would miss paths and the public API
  entirely.
- **`/join/<token>` depends on `/signup`.** A person with no account is sent to
  `/signup?invite=<token>`, signs up, and is bounced back to `/join`. Closing
  sign-up outright would silently kill teammate invitations.
- The migration is applied by hand in the Supabase SQL editor — the repository
  has no migration runner in CI.

## Goals / Non-Goals

**Goals:**

- One operator submission produces an account the client can sign into and use
  immediately, with no second tool open.
- No half-built account survives a failed provision.
- The protected stage holds against every write path, not just the settings
  dialog.
- Nothing new is built where something in the repository already does the job.

**Non-Goals:**

- A `platform_admin` role in the database. The allow-list is an environment
  variable; adding a role would mean a new enum value, new RLS policies, and a
  new membership surface for a list that changes once a year.
- Editing or deleting a provisioned account from `/admin`. This change only
  creates.
- Any UI for the Meta credentials on the client side — change 5 consumes them
  server-side.
- Forcing a password change, password expiry, or 2FA.

## Decisions

### D1 — Provision by adjusting what `handle_new_user` already built

`supabase.auth.admin.createUser({ email, password, email_confirm: true,
user_metadata: { full_name } })` fires the existing trigger, which creates the
`accounts` row and the owner `profiles` row. Provisioning then reads the profile
back to learn the `account_id`, renames the account to the clinic name, and
continues.

*Why:* the trigger is the only code path that creates an account today. Writing
a second, parallel path means two definitions of "a new account" that drift —
and the trigger would still fire, so we would be racing our own insert against
it.

*Alternative rejected:* a single `SECURITY DEFINER` SQL function doing
everything in one transaction. The auth user and the UAZAPI instance live
outside the database, so the transaction would be a false promise; and the
function would duplicate the trigger.

*Consequence:* because the trigger hides its own failures, the orchestrator
reads `profiles` after `createUser` and fails the provision when the row or its
`account_id` is missing.

### D2 — Ordered steps with compensating rollback, riskiest call last

There is no distributed transaction available. The orchestrator runs the steps
in this order, with the failure-prone external call last:

1. `auth.admin.createUser` (confirmed) → trigger creates account + owner profile
2. read `profiles` → `account_id`; fail if absent
3. update `accounts`: clinic name, `meta_dataset_id`, `meta_access_token`
   (encrypted)
4. insert `pipelines` + `pipeline_stages` from the specialty template
5. insert `ai_configs` (persona, `auto_reply_enabled=false`, `is_active=true`)
6. `provisionInstance()` — the UAZAPI call
7. update `whatsapp_config` with `inbound_default_pipeline_id` /
   `inbound_default_stage_id`

Rollback on any failure: delete the `accounts` row (cascades pipelines, stages,
`ai_configs`, `whatsapp_config`, profiles' account link), then
`auth.admin.deleteUser`. That order is forced by
`accounts.owner_user_id ON DELETE RESTRICT`.

*Why last-risk-last:* steps 1–5 are all Postgres writes that fail fast and
cleanly. UAZAPI is a third-party HTTP call that can time out. Putting it last
means the common failure needs no gateway-side undo.

*Why no gateway undo at all:* UAZAPI deletes an instance that is never connected
after roughly one hour (documented in `reprovisionInstance`'s comment in
`instance.ts`). An orphan instance from a failed step 7 expires on its own. We
do not add a delete-instance call for a case the gateway already cleans up.

*If rollback itself fails*, the orchestrator returns what survived — the auth
user id and the account id — in the operator-facing error, rather than
reporting a clean failure. Spec: "Cleanup cannot complete".

All of this runs server-side with `SUPABASE_SERVICE_ROLE_KEY`, which is already
a required variable; RLS is bypassed deliberately, since the operator is not a
member of the account being created.

### D3 — `is_system` is enforced by database triggers

`pipeline_stages.is_system BOOLEAN NOT NULL DEFAULT false`, plus:

- a `BEFORE UPDATE` trigger that raises when `OLD.is_system` and either the name
  changed or `NEW.position <> 0`;
- a `BEFORE DELETE` trigger that raises when `OLD.is_system`;
- a `BEFORE INSERT` trigger that raises when a new row would take position 0 in
  a pipeline that already has a system stage, or would be inserted with
  `is_system = true` by a client role;
- a partial unique index `(pipeline_id) WHERE is_system` — at most one per
  pipeline.

*Why the database:* the spec requires the refusal to hold for the public API and
direct PostgREST writes, not just the settings dialog. Four small trigger
functions cover every current and future call site; guarding each of the five
call sites in TypeScript would not, and would need re-doing for every new one.

*Free side effect:* `pipeline-settings.tsx` saves the reorder as a single
`upsert` of the whole stage list. One rejected row aborts the whole statement,
which is exactly the spec's "the whole save is rejected, no other stage's
position changes" — no application code needed.

The UI still hides the rename input, the delete button and the drag handle on
the system stage, and shows a short explanation. That is courtesy, not
enforcement; the trigger is the contract.

*Colour stays editable* — the update trigger checks `name` and `position` only.

### D4 — Meta credentials on `accounts`, hidden by column-level GRANT

`meta_dataset_id TEXT` and `meta_access_token TEXT` (ciphertext from the same
`encrypt()` helper) go on `accounts`. RLS is row-level and cannot hide a column,
so the migration narrows the table grant:

```
REVOKE SELECT ON accounts FROM authenticated;
GRANT SELECT (id, name, owner_user_id, default_currency, timezone,
              created_at, updated_at) ON accounts TO authenticated;
```

`service_role` keeps full access, so provisioning and change 5 read the columns
server-side.

*Why this is safe here:* no query in the repository selects `accounts.*`; every
call site names its columns. A `select("*")` added later fails loudly with a
permission error rather than leaking the token — an acceptable trade, and a
comment on the grant says so.

*Alternative rejected:* a separate `meta_config` table with no client-facing
policy. Cleaner isolation, but one more table and one more join for change 5 to
carry, for credentials that are one-to-one with the account anyway.

### D5 — `PLATFORM_ADMINS` checked in middleware and again on submit

`PLATFORM_ADMINS` is a comma-separated list of e-mail addresses, compared
case-insensitively after trimming. The middleware already holds the
authenticated user (including `user.email`), so it rewrites any `/admin` request
from a non-listed session to `/dashboard` — same treatment as a gated feature
path, so the console is indistinguishable from a route that does not exist. The
server action re-reads the session and re-checks the list before doing anything.

An unset or empty variable matches nobody. It is a plain (non-`NEXT_PUBLIC_`)
variable so the operator list never reaches the client bundle.

*Why not a database role:* see Non-Goals.

### D6 — Sign-up becomes invite-only in the middleware

`/signup` is kept but guarded: a request without an `invite` query parameter is
redirected to `/login`. The `/join/<token>` flow already appends
`?invite=<token>`, so teammate invitations keep working untouched. The "create
an account" link is removed from `/login`.

*Why keep the page:* deleting it would require rebuilding the same form inside
`/admin` for teammates, which is more code for the same outcome. The invite
token is the gate; the page is unchanged behind it.

*Note:* the token is not validated by the middleware — `/join` already
validates it, and an invalid token produces an orphan personal account exactly
as it does today. Closing that is out of scope.

### D7 — The password banner is one nullable column

`profiles.password_banner_dismissed_at TIMESTAMPTZ`. Provisioning leaves it
`NULL`; the banner renders while it is `NULL`. Dismissing sets it. The existing
password form in `src/components/settings/password-form.tsx` sets it too, on a
successful `updateUser`, so a client who changes the password never sees the
banner again.

*Why a column rather than local storage:* the banner must follow the client
across devices, and "has this client changed the delivered password" is exactly
the kind of state that must not be lost by clearing a browser.

*Why not derive it from auth metadata:* Supabase exposes no reliable
"password last changed" timestamp to a client session. One column is smaller
than any inference.

The banner itself sits beside `AccountAccessAlert` in the dashboard shell,
which is already the place for account-level notices.

### D8 — Specialty templates are a constant, not data

`src/lib/provisioning/templates.ts` exports one array per specialty. Every array
starts with `{ name: "Em contato", isSystem: true, position: 0 }`:

| Dentist | Physician | Psychologist |
|---|---|---|
| Em contato | Em contato | Em contato |
| Avaliação agendada | Consulta agendada | Sessão experimental agendada |
| Orçamento enviado | Consulta realizada | Sessão realizada |
| Tratamento aceito | Retorno / exames | Em acompanhamento |
| Perdido | Perdido | Perdido |

*Why code:* the set changes when Effect sells into a new specialty — a deploy,
not a runtime event. A templates table would need CRUD, RLS and an editor for
three rows that nobody outside the repository edits.

Colours reuse the `STAGE_COLORS` palette already in `pipeline-settings.tsx`.

## Risks / Trade-offs

- **The `accounts` grant is a foot-gun for future code** → a later
  `select("*")` on `accounts` fails with a permission error instead of
  returning rows. Mitigated by a `COMMENT ON COLUMN` and a comment on the grant
  in the migration naming the reason; the failure is loud and immediate, never
  silent.
- **Rollback is best-effort, not atomic** → a crash between the account delete
  and the user delete leaves an auth user with no account. Mitigated by the
  error surface (D2) reporting exactly what survived, and by the fact that such
  a user can sign in but sees nothing — `getCurrentAccount()` already handles
  the no-profile case.
- **An orphan UAZAPI instance can outlive a failed provision** → costs one
  instance slot for up to an hour before the gateway reaps it. Accepted; the
  alternative is a delete-instance code path used only on a rare failure.
- **Triggers make stage writes fail with a raw Postgres error** → the settings
  dialog must translate that into readable copy rather than showing the
  exception. One message per refusal, in `messages/{pt-BR,en}.json`.
- **`PLATFORM_ADMINS` is a deploy-time list** → adding an Effect operator needs
  a redeploy. Accepted: the list changes rarely, and the alternative is a whole
  role system.
- **Operator sees the client's password in the browser** → it is shown once,
  after success, and never stored or logged. Delivery is the operator's job by
  design; no e-mail is sent.

## Migration Plan

`supabase/migrations/046_provisioning.sql` is written to the repository and run
**by hand** in the Supabase SQL editor, like every migration in this project. It
is idempotent (`IF NOT EXISTS`, `DROP TRIGGER … / CREATE`, guarded
`pg_constraint` checks) and safe to re-run. It contains:

1. `pipeline_stages.is_system` + the partial unique index + three trigger
   functions and their triggers.
2. `accounts.meta_dataset_id` / `accounts.meta_access_token` + the column-level
   grant swap.
3. `profiles.password_banner_dismissed_at`.

Backfill: for every existing account's first pipeline, mark the stage at
position 0 as `is_system` and rename it to "Em contato". Existing accounts are
Effect's own test accounts; no client data is at risk. The backfill runs before
the triggers are created so it is not blocked by them.

**Deploy order:** run the migration first, then deploy the application. Between
the two, the extra columns are unused and the triggers only guard stages that
the backfill just marked — no application depends on them yet.

**Rollback:** drop the three triggers and their functions, drop the two
`accounts` columns, and restore the blanket `GRANT SELECT ON accounts TO
authenticated`. `is_system` and `password_banner_dismissed_at` can be left in
place — they are inert without the triggers and the banner.

Requires `PLATFORM_ADMINS` in the environment before `/admin` is reachable;
`.env.local.example` documents it alongside the existing server-only variables.
