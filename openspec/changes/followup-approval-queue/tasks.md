## 1. Database

- [x] 1.1 Create `supabase/migrations/047_followup_queue.sql` with the `followup_messages` table of design.md D1 (columns, `status` CHECK over the five states, FKs with `ON DELETE CASCADE` to `deals`) and the `UNIQUE (deal_id, offset_minutes)` constraint; verify by reading the file that every object uses `IF NOT EXISTS` or `DROP … CREATE`
- [x] 1.2 Add the `followup_messages` RLS policies to 047 — `SELECT` for `is_account_member(account_id)`, `UPDATE` for `is_account_member(account_id, 'agent')` in both `USING` and `WITH CHECK`, no client `INSERT`/`DELETE` policy; verify a read-only member can select and cannot update
- [x] 1.3 Add the index `followup_messages(account_id, status)` used by the pending queue and the `(deal_id)` lookup used by the confirm flag; verify with `EXPLAIN` that the pending-queue query is an index scan
- [x] 1.4 Add the three `accounts` columns of design.md D4 (`followup_offsets INTEGER[]` default `{7200,1440,120}`, `followup_reminder_template TEXT`, `stale_lead_days INTEGER` default 15) with the cardinality/positivity/duplicate CHECKs; verify each CHECK by attempting a four-offset, a zero-offset and a duplicate-offset update in the SQL editor
- [x] 1.5 Extend migration 046's column-level grant in 047 — `GRANT SELECT (followup_offsets, followup_reminder_template, stale_lead_days) ON accounts TO authenticated`; verify by selecting the three columns through an ordinary member session
- [x] 1.6 Extend the `notifications` type CHECK with `followup_reschedule` (drop and recreate the constraint); verify an insert with the new type succeeds and an unknown type still fails
- [x] 1.7 Add the `SECURITY DEFINER` tick function of design.md D3 reading `followup_cron_url` / `followup_cron_secret` from `vault.decrypted_secrets` and calling `net.http_get` with the `x-cron-secret` header, raising a notice and returning when either secret is missing; verify by running it with the secrets absent and confirming it makes no request
- [x] 1.8 Add the `cron.schedule('followups-tick', '*/15 * * * *', …)` block guarded by an existence check on the `pg_cron` and `pg_net` extensions; verify the migration applies cleanly on a database without them
- [ ] 1.9 Apply 047 by hand in the Supabase SQL editor, then re-run it once; verify the second run completes with no error and `\d followup_messages` shows the unique constraint (MANUAL — you run this)

## 2. Follow-up library

- [x] 2.1 Create `src/lib/followups/settings.ts` reading and validating an account's offsets, template and stale-lead threshold with the defaults of design.md D4; verify with unit tests for the defaults, four offsets, a duplicate offset, a non-positive offset and a non-positive threshold
- [x] 2.2 Create `src/lib/followups/template.ts` exporting the legal placeholder set (`{nome}`, `{data}`, `{hora}`, `{medico}`) plus one validator used by both the settings form and the renderer; verify with a unit test that an unknown placeholder is named in the rejection
- [x] 2.3 Create `src/lib/followups/render.ts` rendering a body from a template, a deal and the account timezone, formatting `{data}` / `{hora}` with `Intl.DateTimeFormat` and resolving `{medico}` from the deal's `medico` custom field (design.md D5, D6); verify with unit tests that a `America/Sao_Paulo` account renders the local date and time, and that a missing `medico` renders empty with no literal `{medico}` left in the output
- [x] 2.4 Create `src/lib/followups/materialize.ts` selecting the due (deal, offset) pairs — `scheduled_at - offset <= now() < scheduled_at`, not archived, status not `lost` — and inserting `pending` rows with `ON CONFLICT (deal_id, offset_minutes) DO NOTHING`; verify with unit tests covering the three default offsets, a second run producing nothing, a deal with no `scheduled_at`, a past appointment, an archived deal and a `lost` deal
- [x] 2.5 Add the expiry pass to `src/lib/followups/materialize.ts` moving `pending` and `approved` rows whose deal's `scheduled_at` has passed to `expired`; verify with unit tests that a `sent` row is untouched and an `approved` row does expire
- [x] 2.6 Add a unit test asserting `src/lib/followups/materialize.ts` imports nothing from `src/lib/whatsapp/` (design.md D2 — the cron structurally cannot send)
- [x] 2.7 Create `src/lib/followups/buttons.ts` building and parsing the `fu:<id>:confirm` / `fu:<id>:reschedule` ids of design.md D8; verify with unit tests that a well-formed id round-trips and that an unrelated reply id, an empty string and a malformed `fu:` id all parse to null

## 3. Cron endpoint

- [x] 3.1 Create `src/app/api/followups/cron/route.ts` as a `GET` reusing the `timingSafeEqual` secret check from `src/app/api/flows/cron/route.ts` against `AUTOMATION_CRON_SECRET`, returning 503 when unconfigured and 401 on a mismatch; verify with route tests for a missing secret, a wrong secret and a wrong-length secret
- [x] 3.2 Wire the route to the materialise and expire passes and have it return the counts of each; verify with a route test that a successful call sends no message and reports both counts
- [x] 3.3 Record the last successful tick so the queue can display it (design.md — Risks); verify the timestamp advances after a call and does not advance after a 401

## 4. Approval queue API

- [x] 4.1 Create `POST /api/followups/[id]` handling `approve`, `reject` and `edit_and_send`, requiring agent permission and account-scoping the row; verify with tests that a read-only member is refused and a member of another account gets the same treatment as a missing row
- [x] 4.2 Implement the conditional status transition of design.md D7 — update filtered by `.eq("status","pending")` and treat zero returned rows as a conflict; verify with a test where a second decision on the same row is refused and only one send happens
- [x] 4.3 Send the approved follow-up through `sendMessageToConversation()` with the two-button interactive payload from `src/lib/followups/buttons.ts`, then write `sent_at` and `whatsapp_message_id`; verify with a test that the delivered payload carries the frozen body and both button ids
- [x] 4.4 On a send failure, keep `status = 'approved'`, persist `last_error` and return the error; verify with a test that mocks a gateway failure and asserts the row is not `sent` and a retry succeeds without re-preparing
- [x] 4.5 Make `edit_and_send` persist the edited body inside the same transition so the stored body equals what was delivered; verify with a test comparing the stored body to the payload passed to the send
- [x] 4.6 Refuse `approve`, `reject` and `edit_and_send` on a row that is `sent`, `rejected` or `expired`; verify with one test per terminal state

## 5. Webhook button routing

- [x] 5.1 In `src/app/api/whatsapp/webhook/[secret]/route.ts`, add the follow-up routing call after the duplicate-insert early return and the `bump_conversation_on_inbound` RPC, without setting `flowConsumed` (design.md D9); verify with a webhook test that automations triggering on `interactive_reply` still fire for a reminder reply
- [x] 5.2 Implement the confirm branch — stamp `deals.appointment_confirmed_at` only when currently null, and set `appointment_confirmed = true` on the deal's remaining `pending` rows without changing their status; verify with a test asserting the later rows are still `pending` and flagged
- [x] 5.3 Implement the reschedule branch — insert one `followup_reschedule` notification per account member with agent permission or above, carrying the conversation id, and change no deal column; verify with a test asserting `scheduled_at` and the deal's stage and status are untouched
- [x] 5.4 Ignore a reply whose follow-up belongs to another account, and wrap the whole routing call so a failure is logged and never propagates; verify with tests for the cross-account reply and for a thrown error leaving the inbound message intact
- [x] 5.5 Verify a typed "Confirmar" is not treated as a button press, using a webhook test whose message carries no `buttonOrListid`
- [x] 5.6 Verify redelivery is exactly-once with a webhook test that replays the same confirm reply twice and asserts one message in the thread and one `appointment_confirmed_at`

## 6. Settings UI

- [x] 6.1 Add the follow-up configuration panel (offsets, reminder template, stale-lead days) to the existing `deals` settings section; verify the panel is reachable at `/settings?tab=deals` and shows the account's stored values
- [x] 6.2 Enforce admin-only editing in the UI and rely on the `accounts_update` policy as the backstop; verify by submitting the form as an agent and confirming the write is rejected and the stored values are unchanged
- [x] 6.3 Validate the template client-side with `src/lib/followups/template.ts` and state which custom-field key `{medico}` reads; verify an unknown placeholder is rejected before submission with the offending token named
- [x] 6.4 Add the `pt-BR` and `en` keys for the panel, including the default reminder template text; verify no hard-coded user-facing string remains in the component

## 7. Pending approval queue UI

- [x] 7.1 Add the "Pending approval" section to `src/app/(dashboard)/notifications/page.tsx` listing the account's `pending` follow-ups with lead, appointment time, rendered body and the last successful tick time; verify the list is account-wide rather than per-user
- [x] 7.2 Wire Approve, Reject and Edit-and-send to `POST /api/followups/[id]`, with the editor pre-filled with the stored body; verify each action updates the list without a page reload
- [x] 7.3 Show the already-confirmed flag on rows whose deal the lead has confirmed, and show `last_error` on a row whose send failed; verify both states render distinctly from a plain pending row
- [x] 7.4 Hide the three actions for a read-only member while keeping the list visible; verify with the existing `useCan` permission hook
- [x] 7.5 Surface the conflict from a second decision as a readable message rather than a raw error; verify by firing two approvals and confirming the second shows the "already decided" copy
- [x] 7.6 Add the `pt-BR` and `en` keys for the section; verify no hard-coded user-facing string remains

## 8. AI follow-up draft

- [x] 8.1 Add `mode: "followup"` to `buildSystemPrompt` in `src/lib/ai/defaults.ts` with the follow-up framing, leaving the CFM guardrail scaffold untouched; verify with a unit test that the guardrail text is present in all three modes
- [x] 8.2 Accept `mode` and an optional `style` on `POST /api/ai/draft`, defaulting the style to `ai_configs.followup_style` and never persisting a per-request style; verify with tests that a per-request style reaches the generation and that the account default is unchanged afterwards
- [x] 8.3 Return 422 when the conversation has no messages instead of generating; verify with a route test on an empty conversation
- [x] 8.4 Add the "AI follow-up" action to the lead surface with a review drawer offering a style picker, edit and send; verify the action is hidden for a read-only member and that closing the drawer sends nothing
- [x] 8.5 Verify the action is available with auto-reply switched off, using an account whose automatic replies are disabled

## 9. Reactivation list

- [x] 9.1 Add the reactivation tab to `src/app/(dashboard)/pipelines/page.tsx` with the query of design.md D12 (deals joined to conversations, `last_message_at` older than N days) defaulting N to the account's `stale_lead_days`; verify the default view matches the configured threshold
- [x] 9.2 Add the days-without-contact, stage and future-appointment filters and the exact-count badge; verify the badge matches the number of rows for each filter combination
- [x] 9.3 Make an entry open that lead's conversation and confirm no list action moves a deal or changes a stage; verify by filtering and opening and then checking the deal is unchanged
- [x] 9.4 Confirm no multi-select or bulk action exists on the tab; verify by reading the component for any selection state
- [x] 9.5 Add the `pt-BR` and `en` keys for the tab; verify no hard-coded user-facing string remains

## 10. End-to-end verification

- [ ] 10.1 Book a test lead far enough ahead on an account with the default offsets, force the tick three times across the three offset moments, and verify exactly three pending rows exist with correct bodies and that no message was sent
- [ ] 10.2 Approve one pending follow-up and verify the lead receives the reminder with both buttons and that it appears in the inbox thread
- [ ] 10.3 Press Confirmar as the lead and verify `deals.appointment_confirmed_at` is stamped, the remaining two rows are flagged and still `pending`, and `scheduled_at` is unchanged
- [ ] 10.4 Press Remarcar on a second test lead and verify the notification reaches the account's agents and no deal column changed
- [ ] 10.5 Let a pending follow-up pass its appointment untouched and verify it becomes `expired`, leaves the pending list, and cannot be approved
- [ ] 10.6 Run `npm run test`, `npx tsc --noEmit` and `npm run lint`; verify all three are clean
