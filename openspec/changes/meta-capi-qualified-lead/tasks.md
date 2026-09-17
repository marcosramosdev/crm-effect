## 1. Schema and trigger

- [ ] 1.1 Write `supabase/migrations/048_meta_capi.sql` with the CTWA columns on `contacts`, the `meta_waba_id` / `meta_event_name` / `meta_test_event_code` columns on `accounts`, and the `meta_capi_events` table exactly as in design.md D7; verify the migration applies on a fresh database and that `meta_capi_events_deal_event_uniq` exists
- [ ] 1.2 Add the `AFTER UPDATE OF status` and `BEFORE INSERT` triggers on `deals` that enqueue one row when a deal enters `qualified`, skipping when the contact has no `ctwa_clid` or the account has no `meta_dataset_id`; verify by qualifying a deal in SQL and seeing exactly one pending row, and by re-qualifying and seeing no second row
- [ ] 1.3 Enable RLS on `meta_capi_events` with no client policy; verify an anon/authenticated client select returns zero rows while the service role reads them
- [ ] 1.4 Add a SQL-level test (or a scripted check committed under `supabase/`) covering the three skip paths — organic contact, unconfigured account, re-qualify — and verify each inserts nothing

## 2. Inbound attribution capture

- [ ] 2.1 Add the CTWA extraction to `src/app/api/whatsapp/webhook/[secret]/route.ts`: read `message.content.contextInfo.externalAdReply.ctwaClid` and `.sourceID`, write `ctwa_clid`, `ad_source_id`, `ctwa_clid_at` on the contact, last click wins; verify with a unit test built from the real Dr. Arthur Pena payload
- [ ] 2.2 Make capture non-fatal: a failure to persist attribution logs and lets ingestion continue; verify with a test that forces the update to fail and asserts the message is still stored
- [ ] 2.3 Add tests for the organic path (no `externalAdReply` → columns untouched) and the overwrite path (second ad click replaces the stored values); verify both pass in `route.test.ts`

## 3. Conversions API client

- [ ] 3.1 Create `src/lib/meta/capi.ts` building the payload from design.md D4 — seconds-precision `event_time`, `event_id = deal.id`, `action_source`, `messaging_channel`, `user_data`, optional `whatsapp_business_account_id`, optional `test_event_code`, token in the body; verify with a unit test asserting the exact JSON for a configured and an unconfigured-WABA account
- [ ] 3.2 Add the error classifier (retryable vs permanent, per design.md D5) and verify with table-driven tests over network error, 429, 5xx, invalid `ctwa_clid`, malformed payload and OAuth failure
- [ ] 3.3 Assert in a test that the payload never contains a plain-text phone number, name or email

## 4. Delivery pass on the cron

- [ ] 4.1 Create `src/lib/meta/outbox.ts` with the claim step (conditional `pending` → `sending` update, bounded batch) and verify with a test that two concurrent claims never return the same row
- [ ] 4.2 Implement the freshness check before any HTTP call — click older than 7 days or future `event_time` → `expired` with the stale-click reason; verify with tests at 6 days, 8 days and a future timestamp
- [ ] 4.3 Implement send + outcome recording: `sent` with `sent_at` and response, or backoff `now() + 5min * 2^attempts` capped at 6 attempts, or `failed` with Meta's verbatim body in `last_error`; verify with tests for each terminal and non-terminal outcome
- [ ] 4.4 Decrypt `meta_access_token` with the existing `src/lib/whatsapp/encryption.ts` helper and verify a GCM-encrypted token round-trips through the sender in a test
- [ ] 4.5 Wire `deliverCapiEvents(admin)` as a third pass in `src/app/api/followups/cron/route.ts`, returning its counts alongside `created` / `expired`; verify the route test asserts the new counts and that the secret check still rejects an unauthenticated call

## 5. Provisioning and operator console

- [ ] 5.1 Add `meta_waba_id`, `meta_event_name` and `meta_test_event_code` to the provisioning form and its server action, all optional, token encrypted on write; verify by provisioning a test account with and without the advertising fields and checking both succeed
- [ ] 5.2 Add the on-screen note that the event name must match the ad set's optimization event, and the short setup procedure from design.md D6 next to the fields; verify the text is present in the rendered form
- [ ] 5.3 Add an operator edit path for the advertising credentials on an existing account; verify a changed dataset ID takes effect on the next conversion without re-provisioning
- [ ] 5.4 Add the `/admin` counters — pending, failed, expired, last delivery tick — plus a per-account flag for incomplete configuration and for test mode; verify with seeded rows in each state

## 6. End-to-end verification

- [ ] 6.1 Run the full suite (`npm run test`, `npm run lint`, `npm run build`) and verify green
- [ ] 6.2 Replay the real webhook payload against a local instance and verify `ctwa_clid` lands on the contact, then qualify that contact's deal and verify one pending row appears with the click snapshot
- [ ] 6.3 With a `meta_test_event_code` set on a real account, run the cron pass and verify the event appears in Meta Events Manager → Test Events, then clear the code and confirm subsequent events are delivered without it
- [ ] 6.4 Re-run the delivery pass against an already-`sent` row and verify no duplicate request is made; independently confirm in Events Manager that a redelivered `event_id` is deduplicated
- [ ] 6.5 Update `docs/plano-changes-openspec.md` if any decision here diverged from the plan, and verify `openspec validate meta-capi-qualified-lead --strict` passes
