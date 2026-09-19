## Context

See proposal.md — Why. What the design has to work with:

- `disconnectInstance(db, accountId)` (`src/lib/whatsapp/instance.ts:576`)
  already does the whole teardown: `DELETE /instance` authenticated with the
  account's own instance token, then clears `instance_id`, `instance_token`,
  `paired_phone`, `paired_at` and sets `connection_state = 'disconnected'`. It
  is best-effort against the gateway — a failure is `console.warn`ed and
  swallowed, a 404 is treated as the goal state. It returns `void`.
- It opens with `requireInstance()`, which throws
  `InstanceError("not_provisioned", …, 400)` when the account has no
  `instance_id`/`instance_token`.
- Its only caller today is `POST /api/whatsapp/config` with
  `action: 'disconnect'` (`src/app/api/whatsapp/config/route.ts:166`), under
  `requireRole('admin')` with the caller's own RLS client.
- `instanceName(accountId)` — `wacrm-${accountId}` — is the name the instance
  carries in UAZAPI's own instance list. It is private to `instance.ts`.
- `PATCH /api/admin/accounts/[id]` (`src/app/api/admin/accounts/[id]/route.ts`)
  writes the `accounts` row through `supabaseAdmin()` (service-role), because
  an operator is not a member of the client's account. On the deactivate branch
  it then cancels waiting `meta_capi_events`, and it already has a precedent
  for a partial success: when the cancel fails it returns
  `{ ok: true, deactivated: true, canceledConversions: null, warning }` with
  status 200, rather than a 500 that would hide the deactivation that landed.
- `AccountLifecycle` (`src/components/admin/account-lifecycle.tsx`) already
  renders `json.warning` as a `toast.warning`, and already gates the
  waiting-conversions line on `waitingConversions > 0`.

## Goals / Non-Goals

**Goals:**

- One teardown implementation, shared by the client's disconnect and the
  operator's deactivation — the gateway call, the scoping and the column
  clearing must not drift apart in two places.
- Deactivation never fails because of the gateway.
- The operator learns about an orphan in the same response that confirms the
  deactivation.

**Non-Goals:**

- No retry queue, no reconciliation job that sweeps UAZAPI for orphans. One
  warning naming the instance is what the spec asks for; a sweeper needs the
  server admin token and a schedule, and neither exists for this.
- No change to what `POST /api/whatsapp/config` `action: 'disconnect'` reports
  to the client — a client disconnecting stays silent on gateway failures.
- No change to the deactivation enforcement path (`getCurrentAccount()`), to
  the conversion cancellation, or to the `accounts` schema.

## Decisions

### D1 — Widen `disconnectInstance()` instead of adding a second teardown

`disconnectInstance` becomes:

```ts
export interface TeardownResult {
  /** The instance left running on the gateway, when the delete did not land. */
  orphan: { instanceId: string; name: string } | null;
}
export async function disconnectInstance(
  db: SupabaseClient,
  accountId: string,
): Promise<TeardownResult>
```

Two behaviour changes, both additive for the existing caller:

1. **No instance is a no-op**, not a throw. It returns `{ orphan: null }`
   instead of calling `requireInstance()`. An account that never connected, or
   one the client already disconnected, has nothing to release — the admin path
   needs that, and for the config route it turns a 400 on a double-disconnect
   into the idempotent success it should always have been.
2. **The gateway failure is reported to the caller** rather than only logged.
   The `console.warn` stays; the returned `orphan` lets a caller that has a
   human in front of it say something. `POST /api/whatsapp/config` ignores the
   return value, so its behaviour is unchanged.

Alternative considered: a separate `tearDownInstanceForAccount()` in the admin
layer. Rejected — it would duplicate the column list, the token decryption and
the account-scoped `DELETE /instance` call, which is exactly the code that must
not diverge between the two paths.

### D2 — The orphan is named by instance name and id

`instanceName(accountId)` (`wacrm-<accountId>`) is what UAZAPI's own instance
list shows, so it is the string an operator can actually search for there; the
`instance_id` is what identifies it unambiguously. The warning carries both.
`instanceName` gets exported for the warning's sake — it is already the single
source of that name.

The instance token is never part of the warning: it is a credential, and the
operator does not need it to delete an instance from UAZAPI's own console.

### D3 — Teardown runs on the deactivate branch, after the `accounts` write

Order inside `PATCH`: write `accounts.deactivated_at`, cancel waiting
conversions, then tear down the instance. Deactivation is the cut that matters
and it must land first; the teardown is cleanup that is allowed to report a
partial failure without unwinding anything. Running it last also means a thrown
error from the `whatsapp_config` update cannot leave an account that is still
in service with a deleted instance.

The route passes `supabaseAdmin()` — the same service-role client it already
uses — because an operator holds no membership and `whatsapp_config`'s policies
are membership-based.

### D4 — One `warning` field, not two

The response already carries a single `warning` string for the failed
conversion cancel, and the component already toasts it. The orphan reuses that
field rather than adding a parallel one. The two failures are independent but
practically exclusive (a gateway outage and a Postgres write failure in the
same request), and if both fire the conversion warning wins — it is the one
with money attached. `canceledConversions` keeps its current meaning.

### D5 — The confirmation warns unconditionally; the deactivated state describes what happened

The confirmation line about losing the WhatsApp connection is shown for every
account, not only connected ones. It is a promise about what deactivation does,
and an operator reading a different confirmation per account learns nothing
reliable. This departs from the `waitingConversions > 0` gating next to it,
deliberately: a conversion count is a fact about this account, a teardown is a
property of the action.

The *deactivated* state description is the opposite case — it describes what
already happened to this account, so `deactivatedDesc` drops its
"nothing was deleted — reactivating restores it as it was" claim and says
instead that CRM data is intact and the WhatsApp connection was deleted and
must be paired again.

## Risks / Trade-offs

- **An operator deactivates by mistake and the client loses a working
  pairing.** → The type-the-account-name confirmation already stands between
  the two, and now states the connection loss above the input. Re-pairing is a
  QR scan, not a data loss.
- **A gateway outage during a batch of deactivations leaves several orphans,
  each reported only in its own toast, which the operator may miss.** →
  Accepted; the warning also lands in the response body and the server log. A
  sweeper is the Non-Goal above.
- **`disconnectInstance` no longer throws `not_provisioned`.** → The only
  caller branches on `InstanceError.code` for its status mapping and will
  simply stop seeing that code from this call; nothing keys off it downstream.
  Covered by updating the existing `instance.test.ts` case that asserts the
  throw.
- **Teardown after the `accounts` write means a crash between the two leaves a
  deactivated account with a live instance.** → Same class of orphan the
  warning already describes, and the operator can reactivate and deactivate
  again to retry. The reverse order would risk the worse failure: a released
  instance on an account still in service.

## Migration Plan

No migration. No schema change, no backfill. Accounts already deactivated keep
their live instances; an operator who wants those released can reactivate and
deactivate them again, which now runs the teardown.
