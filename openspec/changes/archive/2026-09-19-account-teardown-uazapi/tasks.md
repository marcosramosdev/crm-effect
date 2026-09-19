## 1. Teardown helper

- [x] 1.1 In `src/lib/whatsapp/instance.ts`, change `disconnectInstance` to
  return `Promise<TeardownResult>` (`{ orphan: { instanceId, name } | null }`,
  exported), replacing `requireInstance()` with a `loadConfigRow()` read that
  returns `{ orphan: null }` when the row is missing or carries no
  `instance_id`/`instance_token` (design.md D1). Verify by type-check:
  `npx tsc --noEmit` passes.
- [x] 1.2 Set `orphan` to `{ instanceId, name: instanceName(accountId) }` when
  the gateway `DELETE /instance` throws anything other than a 404
  `UazapiError`, and leave it `null` on success or on 404; keep the existing
  `console.warn` and keep clearing the columns unconditionally (design.md
  D1/D2). Export `instanceName`. Verify with the tests in 1.3.
- [x] 1.3 Update `src/lib/whatsapp/instance.test.ts`: replace the case that
  asserts `disconnectInstance` throws `not_provisioned` with one asserting it
  resolves to `{ orphan: null }` and makes no gateway call; assert the
  gateway-failure case returns an `orphan` carrying `wacrm-<accountId>` and the
  stored `instance_id` while still clearing the columns; assert a 404 returns
  `{ orphan: null }`. Verify `npx vitest run src/lib/whatsapp/instance.test.ts`
  passes.

## 2. Deactivation tears the instance down

- [x] 2.1 In `src/app/api/admin/accounts/[id]/route.ts`, on the deactivate
  branch and after the conversion cancel, call `disconnectInstance(db,
  accountId)` with the existing `supabaseAdmin()` client, and set the
  response's `warning` to an orphan message naming the instance name and id
  when it returns one — the conversion-cancel warning still wins when both
  fire (design.md D3/D4). Verify with the tests in 2.3.
- [x] 2.2 Catch anything thrown by the teardown in that same branch: log it and
  return the deactivation as successful with the orphan warning, so no gateway
  or `whatsapp_config` failure can turn a landed deactivation into a 500
  (specs/admin-console, "A gateway failure does not block a deactivation").
  Verify with the tests in 2.3.
- [x] 2.3 Extend `src/app/api/admin/accounts/[id]/route.test.ts`: deactivating
  a connected account calls the teardown once with that account id; a teardown
  that reports an orphan still returns 200 with `ok: true` and a warning naming
  the instance; a teardown that throws still returns 200; reactivating
  (`deactivated: false`) calls no teardown. Verify
  `npx vitest run "src/app/api/admin/accounts/[id]/route.test.ts"` passes.

## 3. What the operator reads

- [x] 3.1 In `messages/en.json` and `messages/pt-BR.json` under
  `AdminConsole.lifecycle`: add `confirmConnection` (the WhatsApp connection is
  deleted and the client must pair the number again) and `orphanInstance`
  (an instance was left on the gateway, with `{name}` and `{id}` to remove by
  hand); rewrite `deactivatedDesc` and `confirmPrompt` to drop the
  "nothing was deleted" / "nada é apagado" claim and state that CRM data stays
  and the connection does not (design.md D5). Verify both files parse and carry
  the same key set: `node -e "const a=require('./messages/en.json'),b=require('./messages/pt-BR.json');const k=o=>Object.keys(o.AdminConsole.lifecycle).sort().join();if(k(a)!==k(b))throw new Error('key mismatch')"`.
- [x] 3.2 In `src/components/admin/account-lifecycle.tsx`, render
  `t("confirmConnection")` in the confirmation block for every account —
  ungated, unlike the `waitingConversions > 0` line beside it (design.md D5).
  Verify by opening a never-connected account's page in the console and seeing
  the line before confirming.
- [x] 3.3 Confirm the orphan warning reaches the operator: the component
  already toasts `json.warning`, so verify by deactivating an account with
  `UAZAPI_BASE_URL` pointed at an unreachable host and seeing the account go
  out of service with a warning toast naming the instance.

## 4. Verification

- [x] 4.1 Run `npx tsc --noEmit`, `npx eslint .` and `npx vitest run` — all
  clean.
- [ ] 4.2 End to end against a real gateway: connect an account, deactivate it,
  and verify the instance is gone from UAZAPI's instance list and
  `whatsapp_config` has null `instance_id`, `instance_token`, `paired_phone`
  and `paired_at` with `connection_state = 'disconnected'`; then reactivate and
  verify the client's contacts, deals and conversations are intact, the console
  shows the account as not connected, and the connection screen offers a fresh
  QR code.
