## Why

Deactivating an account today only marks `accounts.deactivated_at` and cancels
the conversions still waiting to be delivered. The account's UAZAPI instance
stays up: it occupies a paid slot on the gateway and keeps a live WhatsApp
session for a clinic that is no longer a client. Every deactivation leaks one
instance, and nothing in the product ever reclaims it.

## What Changes

- Deactivating an account deletes that account's gateway instance and clears the
  stored instance credentials and pairing details, leaving the account in the
  same unconfigured state a never-connected account starts from.
- **BREAKING** (to the promise, not to an API): reactivation no longer restores
  the WhatsApp connection. CRM data — contacts, deals, conversations, history,
  configuration — still comes back untouched, but the account returns
  disconnected and the client must pair a number again. The admin-console
  requirement that says deactivation "SHALL destroy nothing" and that
  reactivation "SHALL restore access to exactly what was there" is corrected to
  carve out the connection.
- The deactivation confirmation states, before the operator confirms, that the
  WhatsApp connection will be lost and will need a new pairing — alongside the
  waiting-conversions warning it already carries.
- When the gateway cannot be reached, deactivation still succeeds. The operator
  is warned and told which instance was left behind, identified well enough to
  delete it by hand in UAZAPI. An account that cannot be taken out of service
  because the gateway is down is worse than an orphaned instance.
- Reactivation does not provision an instance. The existing connection screen
  already provisions one on the client's next visit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-console`: deactivation stops being lossless — it deletes the gateway
  instance; the confirmation must say so before it applies; and a gateway
  failure must not block the deactivation.
- `whatsapp-connection`: an account's instance is now also torn down by an
  operator deactivating the account, not only by the client disconnecting.

## Impact

- `src/app/api/admin/accounts/[id]/route.ts` — the `PATCH` deactivate branch
  gains the instance teardown and the orphan warning in its response.
- `src/lib/whatsapp/instance.ts` — `disconnectInstance()` is the existing
  teardown; the admin path needs it to tolerate an account that has no instance
  and to report an orphan rather than swallow the gateway failure.
- `src/components/admin/account-lifecycle.tsx` — confirmation copy and the
  post-deactivation warning.
- `messages/en.json`, `messages/pt-BR.json` — `AdminConsole.lifecycle` strings:
  the confirmation, the deactivated-state description (which currently claims
  nothing was deleted), and the orphan warning.
- No migration. No new table or column.
