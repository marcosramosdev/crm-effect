## 1. Migration

- [ ] 1.1 Write `supabase/migrations/049_meta_capi_manual_mark.sql` in the same idempotent style as 048, adding `deals.meta_qualified_at TIMESTAMPTZ` with a `COMMENT` saying it is the operator's reporting decision and independent of `status`; verify it applies twice in a row without error and that every existing deal reads `NULL`
- [ ] 1.2 Re-create `meta_capi_events_status_check` with `canceled` added, before any statement that can write the value; verify `UPDATE meta_capi_events SET status='canceled'` succeeds on a seeded row and that a garbage status is still rejected
- [ ] 1.3 Rewrite `meta_capi_enqueue()` to branch on the mark transition (design.md D3) — enqueue on `NULL → not null`, cancel on `not null → NULL`, do nothing for the other two — keeping `SECURITY DEFINER`, `SET search_path = public`, and the exception block that must never abort the caller's write; verify in SQL that a whole-row `UPDATE` that re-stamps an unchanged `meta_qualified_at` produces nothing
- [ ] 1.4 Implement the cancel as `UPDATE … SET status='canceled' WHERE deal_id = NEW.id AND status IN ('pending','unconfigured')` (design.md D4); verify a `pending` row and an `unconfigured` row both cancel, and that a `sent` row is left untouched
- [ ] 1.5 Implement the revive with `ON CONFLICT (deal_id, event_name) DO UPDATE … WHERE meta_capi_events.status = 'canceled'`, resetting `attempts`, `next_attempt_at` and `last_error` (design.md D5); verify mark → unmark → mark leaves exactly one row, back in `pending`, with the current click and a new `event_time`, and that re-marking a deal whose row is `sent` changes nothing
- [ ] 1.6 Replace the trigger `meta_capi_enqueue_upd` with one on `AFTER UPDATE OF meta_qualified_at`, drop the status-keyed one entirely, and recreate `meta_capi_enqueue_ins` unchanged in shape; verify that moving a deal to `qualified`, to `lost` and back records nothing at all, and that inserting a deal with `meta_qualified_at` already set records one row
- [ ] 1.7 Verify the three enqueue outcomes still hold on the mark (design.md D2 of the sibling change): organic contact writes nothing, click plus dataset writes `pending`, click without dataset writes `unconfigured`, each with `event_time` taken from `now()` rather than from the column
- [ ] 1.8 Cancel the rows the old rule enqueued — `UPDATE meta_capi_events SET status='canceled' WHERE status='pending'` as the last statement in the file (design.md D6); verify `unconfigured` rows are untouched and that the count of `pending` afterwards is zero
- [ ] 1.9 Verify the trigger still cannot break a user's write: `ALTER TABLE meta_capi_events ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID`, mark a deal, confirm the `UPDATE deals` succeeds with a warning, then drop the constraint

## 2. Write path and types

- [x] 2.1 Add `meta_qualified_at?: string | null` to `Deal` in `src/types/index.ts` with the migration-naming JSDoc convention, stating that it is independent of `status` and of `archived_at`; verify `npm run typecheck` passes
- [x] 2.2 Add `meta_qualified_at?: string | null` to the `updateDealInline` patch type in `src/lib/inbox/deals.ts` and to the `onInlineSave` patch type on `DealCard`; verify the existing `src/lib/inbox/deals.test.ts` still passes and add a case asserting the field reaches `.update()` and that `null` is sent as `null` rather than dropped
- [x] 2.3 Wire the mark through `handleInlineDealSave` in `src/app/(dashboard)/pipelines/page.tsx` so it inherits the existing optimistic update and revert-on-failure; verify by forcing the write to fail that the card returns to its previous mark state and the error toast appears

## 3. The card control

- [x] 3.1 Add the toggle to `src/components/pipelines/deal-card.tsx` in the existing hover action group, gated on `useCan("send-messages")` and on `deal.contact?.ctwa_clid` being present (design.md D7/D9); verify a card for an organic contact and a card seen by a viewer both offer no control
- [x] 3.2 Show the marked state as a persistent badge beside the `qualified` / `lost` status badge, using an icon other than `Check`; verify a qualified-and-marked deal, a qualified-and-unmarked deal, and a marked-but-open deal are visually distinct
- [x] 3.3 Commit the toggle immediately with no confirm step, sending the current instant when marking and `null` when clearing; verify the card updates before the write resolves and that the toggle does not start a drag or open the deal detail view

## 4. Wording

- [x] 4.1 Add the card's new strings to `messages/en.json` and `messages/pt-BR.json` under `Pipelines.card`, naming the action after the decision (reporting the lead as a conversion) rather than after Meta's API; verify both files parse and that the card renders in both locales
- [x] 4.2 Add **Conversion mark** to `CONTEXT.md` next to **Qualification**, with `_Avoid_: qualified, won, conversion flag`, so the two senses of "qualified" in this product are separated in the one place that settles vocabulary

## 5. Reconcile the sibling change

- [x] 5.1 Update `openspec/changes/meta-capi-qualified-lead/tasks.md` items 7.3 and 7.4, which instruct the reader to qualify a deal and expect a row; they describe a trigger that no longer exists. Rewrite them against the mark, or mark them superseded by this change, and verify the file no longer tells anyone to test the removed behavior
- [x] 5.2 Add the exclusion of `canceled` to the delivery task 8.1 of that change, alongside the existing "never reviving `unconfigured`"; verify the sentence names both states

## 6. Verification

- [x] 6.1 Run `npm run test`, `npm run lint`, `npm run typecheck` and `npm run build`; verify all green. Typecheck, lint (0 errors) and build are green; `npm run test` is 1074 passed / 5 failed, and the 5 are pre-existing locale failures in `src/lib/currency.test.ts` and `src/lib/dashboard/date-utils.test.ts` (`expected 'US$ 1.234' to contain '1,234'` — the machine's locale, not this change; neither file nor the code they cover is touched here)
- [ ] 6.2 In the running app, drag a card with an ad-originated contact between stages and qualify it from the deal detail view; verify `meta_capi_events` gains nothing
- [ ] 6.3 Mark that same card; verify one row appears with the contact's click and an `event_time` within seconds of the click on the button, and that the deal's `status` is unchanged
- [ ] 6.4 Unmark it, then mark it again; verify there is still exactly one row, that it passed through `canceled`, and that it ends `pending` (or `unconfigured` if the account has no dataset) with a fresh `event_time`
- [ ] 6.5 Sign in as a clinic user and mark a deal from the board; verify it succeeds. This is the only check that catches a lost `SECURITY DEFINER` on the rewritten function, and no test in this repository substitutes for it
- [x] 6.6 Verify `openspec validate meta-capi-manual-qualification --strict` passes
