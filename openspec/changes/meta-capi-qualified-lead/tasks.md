## 1. Schema and triggers

- [x] 1.1 Write `supabase/migrations/048_meta_capi.sql` with the `contacts` attribution columns, the `accounts` advertising columns, and the `meta_capi_events` table exactly as in design.md D11; verify it applies on a fresh database and that `meta_capi_events_deal_event_uniq` and both secondary indexes exist
- [x] 1.2 Add `meta_page_id`, `meta_event_name`, `meta_test_event_code` and `meta_send_ph` **without** touching migration 046's `GRANT SELECT` column list, with a comment saying the omission is deliberate; verify `SET LOCAL ROLE authenticated; SELECT meta_page_id FROM accounts LIMIT 1;` raises `permission denied for table accounts` while `SELECT id, name, timezone FROM accounts LIMIT 1;` still works
- [x] 1.3 Write the enqueue function with `SECURITY DEFINER` and `SET search_path = public`, behind `AFTER UPDATE OF status` and `AFTER INSERT` triggers (`_upd` / `_ins`), implementing design.md D2; verify the three enqueue paths in SQL — organic writes nothing, click with a dataset writes one `pending`, click without a dataset writes one `unconfigured`
- [ ] 1.4 Verify `AFTER INSERT` rather than `BEFORE INSERT`: `INSERT INTO deals (…, status) VALUES (…, 'qualified')` must produce one row. A `BEFORE INSERT` trigger fails the `deal_id` foreign key and aborts the deal insert — this check is the regression guard
- [ ] 1.5 Verify the snapshot: qualify a deal, then change the contact's `ctwa_clid`, and confirm the recorded row still holds the original click
- [ ] 1.6 Verify re-qualification and no-op writes: move a deal out of `qualified` and back, then run `UPDATE deals SET status='qualified' WHERE status='qualified'` — one row total, no error
- [ ] 1.7 Verify the trigger cannot break the user's write: `ALTER TABLE meta_capi_events ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID`, qualify a deal, confirm the `UPDATE` succeeds with a warning, then drop the constraint
- [ ] 1.8 Enable RLS on `meta_capi_events` with zero policies and a comment explaining why it is empty; verify an `authenticated` session selects zero rows while the service role reads them
- [ ] 1.9 Sign in to the running app as a clinic user and drag a card to Qualified; verify it succeeds. This is the only check that catches a missing `SECURITY DEFINER`, and no test in this repository can substitute for it

## 2. Inbound attribution capture

- [x] 2.1 Add an exported pure `parseCtwa(content: unknown)` to `src/app/api/whatsapp/webhook/[secret]/route.ts` handling both shapes UAZAPI sends (`oneOf: [object, string]`, design.md D10); verify with unit tests over the real Dr. Arthur Pena payload in object form, the same payload as a JSON string, a message with no `externalAdReply`, and an empty `ctwaClid`
- [x] 2.2 Add a best-effort capture helper modelled on `flagBroadcastReplyIfAny`, called right after `findOrCreateContact` resolves and above the reaction and duplicate-message short-circuits; verify the contact ends up with `ctwa_clid`, `ad_source_id` and `ctwa_clid_at`
- [x] 2.3 Skip the write when the incoming click equals the stored one; verify a redelivered first message does not move `ctwa_clid_at`
- [x] 2.4 Make capture non-fatal: a failure to persist attribution logs and lets ingestion continue; verify with a test that forces the update to fail and asserts the message is still stored
- [x] 2.5 Add tests for the later-message path (no referral block → stored values unchanged) and the overwrite path (a different ad click replaces all three values). Note that the webhook test's fake `contacts` branch currently discards the update patch — make it record into `h.state`, as `configUpdates` already does

## 3. Types

- [x] 3.1 Add the three attribution fields to `Contact` in `src/types/index.ts` with the migration-naming JSDoc convention; verify `npm run typecheck` passes. Add nothing to `Account` — the advertising columns are not client-readable — and keep the outbox row shape in the module that reads it, not in this file

## 4. Settle the delivery question (blocks section 7)

Runs after section 2, because the probe needs a real stored click.

- [ ] 4.1 In the Effect's Events Manager, create a dataset for the clinic — or reuse an existing Pixel of theirs, noting which Business Manager owns it — and share it with the client's ad account
- [ ] 4.2 Generate the access token on that dataset (Settings → Conversions API → Generate access token) and verify it can see the dataset with `GET /v23.0/<DATASET_ID>?fields=id,name,owner_business`; an `error.code: 190` means a bad token, `100` / `#803` means token and dataset sit under different Business Managers
- [ ] 4.3 Post one event with a fresh `ctwa_clid` taken from `contacts`, `action_source: business_messaging`, `messaging_channel: whatsapp`, `partner_agent: effect_crm_1_0`, no WABA id, and a `test_event_code`; verify **by looking in Events Manager → Test Events**, not by trusting `events_received`
- [ ] 4.4 Run the two controls — a garbage `ctwa_clid`, and the same event with `messaging_channel` removed; verify the garbage click is rejected and the malformed event errors. If both are accepted, the dataset is a black hole and 4.3's success does not count
- [ ] 4.5 Record all three verbatim response bodies in design.md D0 — including `error.message` and `error_subcode` on failure — and clear the test event code afterwards

## 5. Operator configuration

- [x] 5.1 Make `metaDatasetId` and `metaAccessToken` optional in the provisioning route, `ProvisionInput` and the form, omitting them from the `accounts` update when absent; verify provisioning succeeds with both, with one, and with neither
- [x] 5.2 Add `PATCH /api/admin/accounts/[id]/meta` guarded by `isPlatformAdmin` and re-checked in the route — `src/middleware.ts` gates `/admin` but not `/api/admin`; verify a non-operator session is rejected and writes nothing
- [x] 5.3 Write through the service-role client, not the operator's session: the `accounts` policies are membership-based and an operator is not a member of the client's account; verify the update actually persists
- [x] 5.4 Treat a blank token as "leave unchanged" so re-saving the form cannot overwrite the credential with `encrypt("")`; verify by saving the form twice and confirming the stored ciphertext is unchanged, and that a submitted token is stored encrypted rather than plain
- [x] 5.5 Validate `meta_event_name` as a non-empty simple token; verify a rejected value leaves the account untouched
- [x] 5.6 Add the edit form to `/admin` with the D8 setup checklist, the event-name warning, and the D9 consent precondition next to `meta_send_ph`; verify the text renders in both `messages/en.json` and `messages/pt-BR.json`. Do not add the four new fields to the provisioning form — they have working defaults and belong to this form

## 6. Operator counters

- [x] 6.1 Add pending and unconfigured counts per account to `/admin`, plus a flag for incomplete configuration; verify with seeded rows in each state
- [x] 6.2 Show a warning whenever `meta_test_event_code` is set — an account left in test mode reports nothing while looking configured; verify the warning appears and disappears with the value
- [x] 6.3 Verify an account with zero ad-originated deals reads as "no conversions yet" rather than as an error state

## 7. Verification

- [x] 7.1 Run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run build` and verify green
- [ ] 7.2 Replay the real webhook payload against a local instance; verify all three attribution columns land on the contact
- [ ] 7.3 SUPERSEDED by `meta-capi-manual-qualification`: qualifying no longer enqueues anything. Mark that contact's deal from its board card with the account unconfigured; verify exactly one `unconfigured` row with the click snapshot
- [ ] 7.4 SUPERSEDED by `meta-capi-manual-qualification`: configure the account, mark a second ad-originated deal from its card; verify one `pending` row, and verify the first row is still `unconfigured`
- [x] 7.5 Verify `openspec validate meta-capi-qualified-lead --strict` passes and that `docs/plano-changes-openspec.md` no longer describes the WABA model, the Meta app or the System User

## 8. Delivery — specified only after 4.5

- [ ] 8.1 Blocked on 4.5. If the probe succeeded, append the delivery requirements to `specs/meta-conversions/spec.md` — freshness check before the call, retry classification, bounded attempts, stable `event_id`, test mode, never reviving `unconfigured` and never claiming `canceled`, delivery counters — then build `src/lib/meta/capi.ts`, `src/lib/meta/outbox.ts` and the third cron pass against them. If it failed, record the rejection in design.md D0 and close this change as capture-only
