## Why

Effect does not sell this CRM — it implements it for the clinics it already
serves. An operator creates the account, hands over an address and a password,
and fills in the Meta configuration afterwards. The provisioning form still
asks for everything up front (clinic name, client name, specialty, persona,
dataset, token) before it will create anything, which is the wrong shape for
handing over an address and a password in a minute. And once an account exists,
the console can only edit its advertising configuration: an account that stops
being a client cannot be taken out of service, its name cannot be corrected,
and a lost password cannot be reissued, so the roster stops reflecting who is
actually active.

## What Changes

- Provisioning requires only the client's e-mail address and a password. Every
  other field — clinic name, client full name, persona, the advertising
  credentials — becomes optional and moves behind a collapsed section of the
  form. The specialty stays visible, because it picks the pipeline the account
  is born with.
- An account provisioned with no clinic name is named after the local part of
  the client's e-mail address, so it still reads as itself in the roster.
- The specialty templates are reworked around the two the agency actually sells
  to, the dentist and the physician, so the operator picks one of the two at
  creation time.
- The console gains the operator actions the roster is missing: rename an
  account, reissue its owner's password, deactivate an account, and reactivate
  a deactivated one.
- A deactivated account's members cannot sign in and its data is left intact.
  Deactivation is reversible; nothing in this change deletes an account or its
  data. The roster separates active accounts from deactivated ones.
- Inbound WhatsApp traffic for a deactivated account is still received and
  stored, but the account produces no conversions while it is deactivated.

Non-goals: permanent deletion of an account (a later change, once there is a
purge routine), seeding demo contacts or deals, and any change to how the Meta
dataset and token are edited.

## Capabilities

### New Capabilities

None. Both halves belong to capabilities that already exist.

### Modified Capabilities

- `provisioning`: one submission provisions a complete account from the e-mail
  address and password alone; every other field is optional; the account name
  falls back to the e-mail's local part; the specialty template set is the two
  the agency sells to.
- `admin-console`: the console carries the account's lifecycle — rename,
  password reissue, deactivate and reactivate — and the roster states which
  accounts are active.

## Impact

- Schema: `accounts` gains a deactivation marker (migration 050). Sign-in and
  session validation consult it.
- API: `POST /api/admin/provision` loosens its required fields; new operator
  routes under `/api/admin/accounts/[id]` for rename, password reissue and
  deactivation state.
- UI: `src/components/admin/provisioning-form.tsx` (two required fields plus a
  collapsed rest), `src/components/admin/account-list.tsx` (active vs
  deactivated), and the per-account page at `src/app/admin/accounts/[id]`.
- Auth: `src/middleware.ts` and the account-resolution helpers must turn away a
  member of a deactivated account.
- `src/lib/provisioning/templates.ts` and `provision.ts`: optional inputs and
  the reworked template set.
- Translations under `messages/` for every new operator-facing string.
