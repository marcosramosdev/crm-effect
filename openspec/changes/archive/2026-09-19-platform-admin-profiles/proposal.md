## Why

Who may run the console is a comma-separated environment variable. Adding a
person to the team means a redeploy, the list carries no name, no role and no
record of who added whom, and everyone on it can do everything. At the same
time the product has no notion of an operator as a kind of person: an operator
signs in and lands in `/dashboard`, inside a client shell that offers them an
account sidebar, a "change your password" banner and pending setup steps for a
WhatsApp number and a Meta pixel that will never be theirs. Effect's own staff
are the product's owners; the people inside accounts are its customers, and the
system currently cannot tell the two apart.

## What Changes

- Platform operators move into a database table carrying name, e-mail, role,
  who registered them and when. `PLATFORM_ADMINS` survives as a bootstrap seed
  only: every address in it is an operator with the manager role even with no
  row, so a deployment can never lock itself out.
- Two operator roles. The **manager** is the only one who registers and removes
  operators, on a new screen inside `/admin`. The **admin** does everything
  concerning client accounts — provision, rename, reissue a password,
  deactivate, reactivate, edit the advertising configuration — and sees every
  account, not only the ones they created.
- Registering an operator creates their sign-in identity the same way
  provisioning creates a client's: the manager chooses the password, it is
  shown once, and the system sends no e-mail. Removing an operator removes the
  row; the sign-in identity survives and simply stops being an operator.
- The role is fixed at registration. There is no surface that changes an
  existing operator's role, which is what makes self-promotion impossible; no
  operator can remove themselves either.
- An operator is a member of no account. **BREAKING** for any operator session:
  signing in leads to `/admin`, never to `/dashboard`, and no client surface
  renders for them — no account sidebar, no password banner, no WhatsApp or
  pixel pending step. Signing out lives inside `/admin`.
- The roster stops listing the throwaway account the sign-up trigger creates
  for an operator's own sign-in identity, so "who are our clients today" stays
  the answer the console gives.
- Every operator check stays a server-side re-check on each action, as it is
  today, and now consults the table in addition to the environment.

Non-goals: changing an operator's role after registration, per-account scoping
of what an admin may touch, deleting an operator's sign-in identity, inviting
an operator by e-mail, and any change to what the console does with a client
account.

## Capabilities

### New Capabilities

None. Both halves belong to capabilities that already exist.

### Modified Capabilities

- `provisioning`: the credential that opens the console is an operator record
  in the database or a seed address in the environment, not the environment
  alone; the requirement that governs who reaches the console is rewritten
  around the two roles and the server-side re-check.
- `admin-console`: the console carries the operator roster — register and
  remove, manager-only — states each operator's role, keeps operators out of
  every client surface, routes an operator's sign-in to `/admin`, holds the
  sign-out control, and hides operators' own throwaway accounts from the client
  roster.

## Impact

- Schema: new `platform_operators` table (migration 051), keyed to the sign-in
  identity, with one RLS policy letting a signed-in user read their own row so
  Edge middleware can resolve the role under the caller's session.
- Auth: `src/lib/provisioning/platform-admins.ts` gains an async resolver
  returning the operator's role or nothing; `isPlatformAdmin` is replaced at
  all seven call sites (`src/middleware.ts` and the five `/api/admin/*`
  routes).
- API: new `/api/admin/operators` (list, register) and
  `/api/admin/operators/[id]` (remove), manager-only; the existing account
  routes stay open to both roles.
- Routing: `src/middleware.ts` sends an operator's root and sign-in landings to
  `/admin`; `src/app/(dashboard)/layout.tsx` turns an operator away from every
  client route.
- UI: new `src/app/admin/layout.tsx` (operator identity and sign-out), a new
  operators screen under `/admin`, and `src/app/admin/page.tsx` filtering
  operator-owned accounts out of the roster.
- Translations under `messages/` for every new operator-facing string, and
  `CONTEXT.md` gains the platform-operator terms — including disambiguating the
  existing use of "operator" for a clinic's own user.
