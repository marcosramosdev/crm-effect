## 1. Minimal provisioning

- [x] 1.1 Make every field of `ProvisionInput` optional except `clientEmail`, `clientPassword` and `specialty` in `src/lib/provisioning/provision.ts`, resolving the defaults of design.md D6 at the top of `provision()` — clinic name and full name from the e-mail's local part, persona empty, specialty `dentist`; verify with a unit test that provisioning from address and password alone names the account after the local part
- [x] 1.2 Verify the fallback never produces an empty name: an address whose local part is blank or only punctuation must still yield a usable account name (unit test over the resolver alone)
- [x] 1.3 Drop the `requiredString()` rejections for clinic name, client full name and specialty from `POST /api/admin/provision`, keeping the e-mail, password and event-name validation untouched; verify a body carrying only `clientEmail` and `clientPassword` provisions successfully and a body missing either one is refused with nothing created
- [x] 1.4 Verify the rollback path still holds with the minimal body: a forced failure at the gateway step leaves no auth user and no account behind

## 2. Two specialty templates

- [x] 2.1 Rework `SPECIALTY_TEMPLATES` in `src/lib/provisioning/templates.ts` to exactly `dentist` and `physician` (design.md D7), each keeping "Em contato" as its first, system stage; verify `SPECIALTY_KEYS` has two entries and `src/lib/provisioning/templates.test.ts` still asserts the system-stage invariant for every remaining template
- [x] 2.2 Verify nothing else imports `"psychologist"` — typecheck (`npm run typecheck`) must pass with the key gone
- [x] 2.3 Update the specialty labels in `messages/pt-BR.json` and `messages/en.json` to the two remaining templates and verify no translation key is left orphaned

## 3. The deactivation column

- [x] 3.1 Write `supabase/migrations/050_account_deactivation.sql` adding `accounts.deactivated_at TIMESTAMPTZ NULL` with a column comment stating the sender-side rule of design.md D4, idempotent like every migration in this project; verify re-running it is a no-op
- [x] 3.2 Grant `SELECT (deactivated_at)` on `accounts` to `authenticated` in the same migration (design.md D1) and verify a client session can read the column for its own account while still not reading `meta_access_token`
- [ ] 3.3 Apply the migration by hand in the Supabase SQL editor and verify every existing account row reads `deactivated_at IS NULL`

## 4. Enforcement

- [x] 4.1 Add `AccountSuspendedError` (status 403) beside the existing error classes in `src/lib/auth/account.ts` and map it in `toErrorResponse()`; verify a unit test asserts the 403 and a message distinct from `ForbiddenError`
- [x] 4.2 Widen the `accounts` select in `getCurrentAccount()` to `id, name, deactivated_at` and throw `AccountSuspendedError` when it is non-null (design.md D2); verify with a test that a deactivated account's member gets the suspended error and that the query count is unchanged
- [x] 4.3 Turn `(dashboard)/layout.tsx` into an async server component that calls `getCurrentAccount()` and, on `AccountSuspendedError`, signs the session out and redirects to `/login?suspended=1` (design.md D3); verify a deactivated member's next navigation lands on the login screen with no session cookie
- [x] 4.4 Render the suspension notice on the login screen when `?suspended=1` is present, in both locales, saying access is suspended and to contact the agency — never a wrong-password or generic failure; verify by visiting the URL directly
- [x] 4.5 Verify a platform operator is unaffected: an operator whose own address is on the allow-list still reaches `/admin` and a deactivated account's page

## 5. Operator routes

- [x] 5.1 Add `PATCH /api/admin/accounts/[id]` accepting `{ name?, deactivated? }`, re-checking `isPlatformAdmin` in the route itself (design.md D5); verify a non-operator session is rejected and nothing is written
- [x] 5.2 Implement the rename branch, rejecting a blank or whitespace-only name; verify the account keeps its previous name on rejection and that the new name reaches the client's own surfaces
- [x] 5.3 Implement the deactivate branch: set `deactivated_at = now()`, and in the same request move that account's `meta_capi_events` rows in `pending` and `unconfigured` to `canceled` (design.md D4); verify with seeded rows that both states are cancelled and that `sent` and `failed` rows are untouched
- [x] 5.4 Implement the reactivate branch: clear `deactivated_at`, leaving cancelled conversions cancelled; verify a reactivated account's member can sign in again and sees the same contacts, deals and conversations as before
- [x] 5.5 Add `POST /api/admin/accounts/[id]/password` setting the owner's password through the service-role admin client, re-checking `isPlatformAdmin`, rejecting a password below the sign-in minimum, and returning no password in the response body; verify the response never carries the value and that nothing logs it
- [ ] 5.6 Verify the reissued password works and the previous one does not, and that the owner's prior refresh token no longer grants a session

## 6. Console surfaces

- [x] 6.1 Split the provisioning form into the always-visible e-mail, password and specialty plus one collapsed optional section holding clinic name, client name, persona and the four advertising fields (design.md D8); verify submitting with the section untouched provisions an account
- [x] 6.2 Add `deactivated_at` to the `accounts` select in `src/app/admin/page.tsx` and partition the roster in memory into active and deactivated sections, each row stating its state and each deactivated row its date (design.md D9); verify one query still backs the list
- [x] 6.3 Add the rename control and the password-reissue control to `src/app/admin/accounts/[id]/page.tsx`, the latter showing the new password once in the browser only; verify the page never receives a password from the server
- [x] 6.4 Add the deactivate and reactivate controls with a confirmation that names the account and, when that account has conversions waiting, states that they will be cancelled; verify nothing is written until the confirmation is completed
- [x] 6.5 Verify no console surface offers permanent deletion of an account or its data
- [x] 6.6 Add every new operator-facing string to `messages/pt-BR.json` and `messages/en.json` and verify both files carry the same key set

## 7. Whole-change verification

- [ ] 7.1 Provision an account from address and password alone, sign in as it, deactivate it, confirm sign-in is refused with the suspension notice, reactivate it, and confirm the pipeline, contacts and conversations are exactly as they were
- [ ] 7.2 Verify inbound WhatsApp traffic for a deactivated account is still stored and is present after reactivation
- [ ] 7.3 Run `npm run typecheck`, `npm run lint` and `npm test` and verify all three pass
