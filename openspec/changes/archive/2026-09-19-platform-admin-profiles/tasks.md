## 1. The operator table

- [x] 1.1 Write `supabase/migrations/051_platform_operators.sql` creating `platform_operators` with the columns, keys and `CHECK` of design.md D1, idempotent like every migration in this project; verify re-running it is a no-op
- [x] 1.2 Enable RLS in the same migration with exactly one policy, `SELECT USING (user_id = auth.uid())`, and no write policy (design.md D2); verify a signed-in non-operator's read returns no rows and that an insert from a client session is rejected
- [x] 1.3 Add a column comment stating that the environment seed is resolved before this table and that writes go through the service-role client only; verify the comment is present after applying
- [x] 1.4 Apply the migration by hand in the Supabase SQL editor and verify an operator listed in `PLATFORM_ADMINS` still reaches `/admin` with the table empty — **manual, left for the user per session instruction**

## 2. Resolving an operator

- [x] 2.1 Add `resolvePlatformOperator(client, user)` to `src/lib/provisioning/platform-admins.ts` returning `{ role, seeded }` or `null`, checking `PLATFORM_ADMINS` first and the caller's own row second (design.md D3); verify with unit tests that a seeded address resolves to `manager` with no query, that a recorded address resolves to its stored role, and that an unknown address resolves to `null`
- [x] 2.2 Verify the seed still holds when the table is unreachable: with the row lookup forced to fail, a seeded address must resolve to `manager` and an unrecorded one to `null`
- [x] 2.3 Verify an empty `PLATFORM_ADMINS` and an empty table together resolve nobody, preserving today's "allow-list is unset matches nobody" behaviour
- [x] 2.4 Replace `isPlatformAdmin` at all five `/api/admin/*` routes with the awaited resolver, keeping each route's existing rejection; verify the existing route tests still pass with the mock returning an operator and a non-operator
- [x] 2.5 Remove `isPlatformAdmin` once nothing imports it and verify `npm run typecheck` passes

## 3. Manager-only authorization

- [x] 3.1 Refuse the manager-only surfaces to the admin role in one shared check used by both the route handlers and the page, returning the same rejection a non-operator gets; verify an admin-role session is refused the operator register and a manager is not
- [x] 3.2 Verify every account-facing route still accepts both roles: provision, rename, password reissue, deactivate, reactivate and the two Meta routes each succeed for an admin-role operator

## 4. Operator routes

- [x] 4.1 Add `GET /api/admin/operators` returning every record plus the addresses carried by `PLATFORM_ADMINS` marked as seeded and carrying no registrar; verify a seeded address with no row appears in the response and an admin-role session is refused
- [x] 4.2 Add `POST /api/admin/operators` creating the sign-in identity with `email_confirm: true` and inserting the record with `created_by` and `created_at` (design.md D7); verify the new operator signs in immediately, that no e-mail is sent, and that the response body carries no password
- [x] 4.3 Implement the existing-identity branch: an address with a sign-in identity and no operator record gets the record attached against its `user_id` with its password untouched, and the response says the password was not changed; verify a removed operator is restored this way
- [x] 4.4 Refuse an address that already holds an operator record and a password below the sign-in minimum, creating nothing in either case; verify both rejections leave the table and `auth.users` unchanged
- [x] 4.5 Implement the rollback: a failed record insert deletes the identity just created; verify a forced insert failure leaves no `auth.users` row behind
- [x] 4.6 Add `DELETE /api/admin/operators/[id]` deleting the record only, refusing the caller's own id and any address carried by the environment seed (design.md D8); verify the sign-in identity, its profile and its account all survive a removal, and that the removed operator is turned away from `/admin` on the next request
- [x] 4.7 Verify no route anywhere changes an existing operator's role — a role reaches the table only through registration

## 5. Keeping operators out of client surfaces

- [x] 5.1 Make `src/middleware.ts` resolve the operator on `/`, `/login`, `/signup` and `/forgot-password` and send an operator to `/admin` instead of `/dashboard` (design.md D5); verify a signed-in operator opening `/` or `/login` lands on `/admin` and a client still lands on `/dashboard`
- [x] 5.2 Gate `/admin` on the resolver rather than on `PLATFORM_ADMINS`, and refuse `/admin/operators` to the admin role; verify a recorded admin reaches `/admin`, is bounced from `/admin/operators`, and a non-operator is bounced from both
- [x] 5.3 Add the operator check to `src/app/(dashboard)/layout.tsx` before its `getCurrentAccount()` call, redirecting to `/admin` (design.md D5); verify an operator opening `/inbox`, `/contacts` or `/settings` is redirected and that `DashboardShell` never renders for them
- [x] 5.4 Verify no client surface reaches an operator's browser: no sidebar, no password banner, and no WhatsApp or advertising pending step, on any client route
- [x] 5.5 Verify the client path is untouched: a member of an active account still reaches every route as before, and a member of a deactivated account still lands on `/login?suspended=1`

## 6. Console surfaces

- [x] 6.1 Add `src/app/admin/layout.tsx` carrying the console chrome, the signed-in operator's identity, the sign-out control and the `noindex` metadata (design.md D9); verify sign-out ends the session and lands on `/login`
- [x] 6.2 Show the link to the operator register in that chrome only for the manager role; verify an admin-role operator sees no link to it
- [x] 6.3 Add the operator register screen under `/admin` listing name, address, role, registrar and registration time, marking seeded entries and offering them no removal control; verify a seeded address renders without a registrar
- [x] 6.4 Add the registration form (name, address, role, password) showing the password once after success and saying nothing was changed when an existing identity was adopted; verify the page never receives a password from the server
- [x] 6.5 Add the removal control with a confirmation naming the operator, absent on the caller's own row and on seeded rows; verify nothing is written until the confirmation is completed
- [x] 6.6 Filter operator-owned accounts out of the roster in `src/app/admin/page.tsx` using the operator user ids plus the seeded addresses resolved through `profiles` (design.md D4); verify an operator's own account is absent from the roster while every client account is still listed
- [x] 6.7 Add every new operator-facing string to `messages/pt-BR.json` and `messages/en.json` and verify both files carry the same key set

## 7. Glossary

- [x] 7.1 Add **Platform operator**, **Manager** and **Admin** to `CONTEXT.md`, stating that an operator is a member of no account; verify each entry carries its `_Avoid_` line like the entries around it
- [x] 7.2 Disambiguate the existing use of "operator" for a clinic's own user in the **Conversion mark** entry, so the glossary has one meaning per term; verify no remaining entry uses "operator" for a client-account user

## 8. Whole-change verification

- [ ] 8.1 With the table empty, verify a `PLATFORM_ADMINS` address signs in, lands on `/admin`, registers a manager and an admin, and that both sign in and land on `/admin` — **manual, needs a live deployment**
- [ ] 8.2 Verify the admin-role operator provisions a client account, renames it, reissues its password, deactivates and reactivates it, and edits its advertising configuration, and is refused the operator register throughout — **manual, needs a live deployment**
- [ ] 8.3 Remove the admin-role operator and verify they are turned away from `/admin`, that their sign-in still exists, and that registering the address again restores their access without a new password — **manual, needs a live deployment**
- [ ] 8.4 Verify a client account provisioned in 8.2 still signs in, sees its own shell, and that no operator account appears in the roster — **manual, needs a live deployment**
- [x] 8.5 Run `npm run typecheck`, `npm run lint` and `npm test` and verify all three pass — typecheck clean, lint 0 errors (66 pre-existing warnings, none in touched files), tests 1182/1187 passing (5 pre-existing failures in `currency.test.ts`/`date-utils.test.ts`, unrelated to this change and untouched by it)
