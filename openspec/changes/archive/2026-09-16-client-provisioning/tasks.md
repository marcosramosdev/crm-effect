## 1. Database

- [x] 1.1 Write `supabase/migrations/046_provisioning.sql` with `pipeline_stages.is_system BOOLEAN NOT NULL DEFAULT false` and the partial unique index `(pipeline_id) WHERE is_system`; verify the file is idempotent by reading it for `IF NOT EXISTS` / `DROP … CREATE` on every object
- [x] 1.2 Add the backfill to 046 — for each existing account's first pipeline, set `is_system = true` and `name = 'Em contato'` on the stage at position 0 — placed **before** the trigger definitions so the triggers do not block it
- [x] 1.3 Add the three trigger functions to 046: `BEFORE UPDATE` (raise if `OLD.is_system` and name changed or `NEW.position <> 0`), `BEFORE DELETE` (raise if `OLD.is_system`), `BEFORE INSERT` (raise on position 0 into a pipeline that already has a system stage, or `is_system = true` from a non-service role); verify each raises a distinct, greppable error message
- [x] 1.4 Add `accounts.meta_dataset_id TEXT` and `accounts.meta_access_token TEXT` to 046 with `COMMENT ON COLUMN` stating the token is AES-256-GCM ciphertext and is never client-readable
- [x] 1.5 Add the column-level grant swap to 046 — `REVOKE SELECT ON accounts FROM authenticated` then `GRANT SELECT (id, name, owner_user_id, default_currency, timezone, created_at, updated_at)` — with a comment naming the reason; verify by grepping the repository that no query selects `accounts` with `*`
- [x] 1.6 Add `profiles.password_banner_dismissed_at TIMESTAMPTZ` to 046
- [ ] 1.7 Run 046 by hand in the Supabase SQL editor, then re-run it once; verify the second run completes with no error and `\d pipeline_stages` shows `is_system`

## 2. Provisioning library

- [x] 2.1 Create `src/lib/provisioning/platform-admins.ts` exporting a predicate that reads `PLATFORM_ADMINS`, splits on commas, trims, and compares case-insensitively; verify with a unit test covering unset, empty, single, list-with-spaces, and case-mismatch
- [x] 2.2 Create `src/lib/provisioning/templates.ts` with the dentist / physician / psychologist stage arrays from design.md D8, each starting with `{ name: "Em contato", isSystem: true, position: 0 }`; verify with a unit test asserting every template's first stage is the system stage and positions are contiguous from 0
- [x] 2.3 Create `src/lib/provisioning/provision.ts` implementing the ordered steps of design.md D2 against a service-role Supabase client, reusing `provisionInstance()` from `src/lib/whatsapp/instance.ts` and `encrypt()` from `src/lib/whatsapp/encryption.ts`; verify the module imports neither a new HTTP client nor a new crypto helper
- [x] 2.4 In `provision.ts`, read `profiles` back after `auth.admin.createUser` and fail the provision when the row or its `account_id` is missing (the `handle_new_user` trigger swallows its own errors); verify with a unit test whose mocked profile read returns null and which asserts the provision fails and rolls back
- [x] 2.5 Implement the compensating rollback in `provision.ts` — delete `accounts` first, then `auth.admin.deleteUser` — and return the surviving ids in the error when the rollback itself fails; verify with unit tests that fail at the pipeline step and at the gateway step and assert the delete order and that no account remains
- [x] 2.6 Point `whatsapp_config.inbound_default_pipeline_id` / `inbound_default_stage_id` at the seeded pipeline and its system stage as the final step; verify with a unit test asserting both columns are set to the seeded ids

## 3. Admin console

- [x] 3.1 Add the `/admin` guard to `src/middleware.ts`: a request whose session e-mail is not on `PLATFORM_ADMINS` is rewritten to `/dashboard`, and an unauthenticated one to `/login`; verify by signing in as a non-listed user and confirming `/admin` is indistinguishable from an unknown route
- [x] 3.2 Create `src/app/admin/page.tsx` with the provisioning form — clinic name, client full name, e-mail, password, specialty select, persona textarea, Meta dataset id, Meta access token; verify every field in the spec's "One submission provisions a complete account" requirement is present
- [x] 3.3 Create the server action behind the form that re-checks `PLATFORM_ADMINS` before calling `provision()`; verify with a test that a submission from a non-listed session is rejected and creates nothing
- [x] 3.4 Render the result panel: on success show the client's e-mail and password once for the operator to copy; on failure show which step failed, and what was left behind when cleanup could not complete; verify the password never appears in a server log or a persisted record

## 4. Close public signup

- [x] 4.1 In `src/middleware.ts`, redirect `/signup` to `/login` when the request carries no `invite` query parameter; verify `/signup` alone lands on `/login` while `/signup?invite=<token>` still renders the form
- [x] 4.2 Remove the "create an account" link from `src/app/(auth)/login/page.tsx`; verify by grepping `src/` that no operator-facing surface links to `/signup` except the `/join/<token>` page
- [ ] 4.3 Walk the invitation flow end to end — invite a new e-mail, open `/join/<token>`, sign up, land in the inviting account; verify the new member appears with the invited role

## 5. Protected stage in the UI

- [x] 5.1 Add `is_system` to the `PipelineStage` type in `src/types/index.ts` and to the stage selects that feed `pipeline-settings.tsx`; verify `npx tsc --noEmit` passes
- [x] 5.2 In `src/components/pipelines/pipeline-settings.tsx`, disable the name input, hide the delete button and remove the drag handle for the system stage, and show a one-line explanation; verify the colour picker stays enabled
- [x] 5.3 Translate the trigger's refusal into readable copy when a stage write fails anyway, with keys in `messages/pt-BR.json` and `messages/en.json`; verify by attempting the rename against the live database and confirming no raw Postgres error reaches the screen
- [ ] 5.4 Verify the database refusal independently of the UI: issue a direct PostgREST rename, delete, and reorder against the system stage from a client session and confirm all three fail

## 6. Password banner

- [x] 6.1 Add the dismissible banner beside `AccountAccessAlert` in `src/app/(dashboard)/dashboard-shell.tsx`, shown while `profiles.password_banner_dismissed_at` is null, linking to the password screen; verify it blocks nothing
- [x] 6.2 Set `password_banner_dismissed_at` on dismissal, and also on a successful `updateUser` in `src/components/settings/password-form.tsx`; verify the banner is gone after a reload in both cases
- [x] 6.3 Add the banner copy to `messages/pt-BR.json` and `messages/en.json`; verify both files carry the same keys

## 7. Documentation and verification

- [x] 7.1 Document `PLATFORM_ADMINS` in `.env.local.example` next to the other server-only variables, stating that unset means nobody; verify the file explains the comma-separated format
- [x] 7.2 Run `npm run test` and `npx tsc --noEmit`; verify both are clean
- [ ] 7.3 Provision a test account end to end and verify all four acceptance points: sign-in with the delivered password works on the first attempt with no confirmation e-mail; the pipeline shows "Em contato" first and locked; `/connection` offers a QR code without provisioning a second instance; deleting the system stage is refused
- [ ] 7.4 Verify a partial failure is clean: point `UAZAPI_BASE_URL` at an unreachable host, provision, and confirm the operator sees the gateway-step error and that the e-mail address is free for an immediate successful retry
