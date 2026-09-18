## Why

`meta-capi-qualified-lead` enqueues a conversion the moment a deal's status
becomes `qualified`. That status is the clinic's own sales outcome — it is set
from the deal detail view, it follows the card across the board, and automations
and future server-side writers can set it too. Using it as the reporting trigger
means the CRM decides on the clinic's behalf which leads train the ad account,
and the person who knows whether a lead was actually worth having — the operator
looking at the card — never gets asked.

Reporting is not free and not reversible. Every conversion sent teaches the ad
set to find more people like that one. A lead that qualified for the pipeline
but was a bad fit, a duplicate, a test, or a competitor should not be what the
campaign optimizes towards, and today there is no way to say so.

Now is the moment because nothing has ever been delivered. Delivery is still
gated on the D0 experiment in `meta-capi-qualified-lead`, so every row in the
outbox is unsent. Changing the enqueue rule costs one migration today; after
delivery ships it would mean reconciling rows Meta has already accepted.

## What Changes

- **A deal carries an explicit conversion mark.** New column
  `deals.meta_qualified_at` — the instant an operator marked the lead as worth
  reporting. `NULL` means not marked, and that is the default for every deal,
  existing and new.
- **BREAKING (enqueue rule): the status no longer enqueues anything.** The
  `deals` triggers move from `AFTER UPDATE OF status` to
  `AFTER UPDATE OF meta_qualified_at`, firing on the transition from unmarked to
  marked. Qualifying, un-qualifying, losing, reopening, or dragging a deal
  between stages produces no conversion. The three outcomes at enqueue time —
  nothing for an organic contact, `pending` with a dataset, `unconfigured`
  without one — are unchanged; only what triggers them changes.
- **The recorded conversion time is the mark, not the clock.** `event_time`
  comes from `meta_qualified_at`, so the time Meta is told about is the moment
  the operator decided, not the moment the trigger happened to run.
- **A control on the board card**, next to the existing status badge and behind
  the same send permission as the other card affordances. It is the only surface
  that sets the mark in this change: the deal detail view keeps its `open` /
  `qualified` / `lost` buttons and gains nothing. The control appears only on
  cards whose contact carries an ad click — for an organic lead there is no
  conversion to report and a button that silently does nothing is worse than no
  button.
- **Unmarking cancels an undelivered conversion.** A `pending` or `unconfigured`
  row for that deal becomes `canceled`, a new state in the outbox. A row already
  `sent` is left exactly as it is: Meta does not un-learn, and pretending
  otherwise in our own table would be a lie about what the ad account knows.
- **Re-marking revives a canceled row** rather than being swallowed by the
  `(deal_id, event_name)` unique index, which would otherwise make the first
  unmark permanent and the toggle a one-way door.
- **Rows enqueued under the old rule are canceled by the migration.** None of
  them was ever delivered and none carries an operator's decision, so leaving
  them `pending` would send, on the day delivery ships, exactly the automatic
  conversions this change exists to stop. `unconfigured` rows are left as they
  are — they are a historical counter, and D3 of the sibling change already says
  they never revive.

## Capabilities

### Modified Capabilities

- `meta-conversions`: the trigger for recording a conversion changes from the
  deal's status to an explicit per-deal mark; unmarking cancels an undelivered
  conversion; delivery must never claim a canceled row. The capability's spec
  currently lives in the sibling change `meta-capi-qualified-lead`, which is not
  yet archived.
- `deals`: the board card gains the conversion mark affordance, and the deal's
  reporting mark is added to its built-in attributes as a field independent of
  `status` and of `archived_at`.

## Impact

- **Database**: `supabase/migrations/049_meta_capi_manual_mark.sql` —
  `deals.meta_qualified_at`, the `canceled` state on the
  `meta_capi_events_status_check` constraint, the rewritten `meta_capi_enqueue()`
  function, the replaced triggers, and the one-time cancel of rows enqueued by
  the old rule.
- **Code**: `src/components/pipelines/deal-card.tsx` (the control),
  `src/app/(dashboard)/pipelines/page.tsx` (optimistic write + revert),
  `src/lib/inbox/deals.ts` (`updateDealInline` patch shape),
  `src/types/index.ts` (`Deal.meta_qualified_at`), `messages/en.json` and
  `messages/pt-BR.json`.
- **Docs**: `CONTEXT.md` gains the conversion-mark term, because "qualified" now
  means two different things in this product and the glossary is where that gets
  settled.
- **Blocked work elsewhere**: task 8.1 of `meta-capi-qualified-lead` — the
  delivery pass — must exclude `canceled` alongside `unconfigured` when it
  claims rows. That is recorded here as a requirement so it cannot be missed
  when the sender is finally written.
- **External**: none. This change moves a trigger and adds a button; no request
  leaves the system either way.
