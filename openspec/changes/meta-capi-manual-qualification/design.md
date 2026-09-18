## Context

See `proposal.md` — Why. This change moves one trigger and adds one button; what
makes it worth a design document is that the trigger is the only choke point the
whole capability rests on, and that the outbox has a unique index which turns a
naive cancel into a one-way door.

What is already in place, from `meta-capi-qualified-lead`:

1. **The enqueue path is a database trigger** (`meta_capi_enqueue()`, migration
   048), `SECURITY DEFINER` because migration 046 revoked `SELECT ON accounts`
   from `authenticated` and every board writer runs as that role. That stays
   true here, for the same reason.
2. **`meta_capi_events` has a unique index on `(deal_id, event_name)`.** It is
   what makes "at most one conversion per deal" a database guarantee rather than
   an application convention, and it is the constraint any cancel/re-mark design
   has to live inside.
3. **Nothing has ever been delivered.** Delivery is gated on the D0 experiment
   in the sibling change, so the table holds only `pending` and `unconfigured`
   rows, and no row corresponds to anything Meta has seen.
4. **The board card's persistence path already exists.**
   `updateDealInline()` in `src/lib/inbox/deals.ts` is the shared write, and
   `src/app/(dashboard)/pipelines/page.tsx` owns the optimistic update and the
   revert-on-failure around it.
5. **The board already loads what the control needs.** `loadDeals` selects
   `*, contact:contacts(*)`, and `contacts` has no column-level grant narrowing,
   so both the new deal column and the contact's `ctwa_clid` arrive without
   touching the query.

## Goals / Non-Goals

**Goals:**

- Make the conversion a consequence of one explicit human decision, recorded at
  a single choke point that no writer can bypass.
- Keep the toggle honestly reversible: unmark cancels, re-mark revives, and
  neither loses the record that it happened.
- Change nothing about how the conversion itself is shaped — click snapshot,
  event name, the three enqueue outcomes — so the delivery work still to be
  written is unaffected.

**Non-Goals:**

- A mark control anywhere but the board card. The deal detail view, the contact
  sidebar and the inbox keep exactly what they have; the operator chose one
  surface and a second one is a second thing to keep consistent.
- Reporting on marks — how many were marked, by whom, when. The outbox row
  already carries the time; a report over it is a different change.
- Any change to what `open` / `qualified` / `lost` mean for the clinic. The
  status keeps its sales meaning and simply stops being an ad-platform trigger.
- Bulk marking, or marking from the archived view.

## Decisions

### D1 — A nullable timestamp, not a boolean

`deals.meta_qualified_at TIMESTAMPTZ` — `NULL` means unmarked, and that is every
existing row with no backfill and no default.

*Why:* the mark has a time, and that time is what a human reads when asking "when
did we decide to report this one". A boolean would need a companion
`meta_qualified_at` anyway, and two columns describing one fact can disagree.

*Alternative considered:* reusing `deals.status` with a fourth value. Rejected:
the two decisions are genuinely independent — a lost deal can be one the clinic
still wants the campaign to learn from, and a qualified one can be a duplicate
nobody should optimize towards.

### D2 — The trigger stamps `event_time` with `now()`, not with the column

The column is written by the browser under RLS, so its value is whatever the
client sent — a clock that drifts, or a deliberately chosen instant. The trigger
runs in the same transaction as that write, so `now()` is the mark instant to
within a round trip, and it is the only one of the two that cannot be dictated
from outside.

*Consequence:* `meta_qualified_at` is what the operator's own UI shows;
`meta_capi_events.event_time` is what Meta would eventually be told. They differ
by milliseconds, and the sibling change's payload builder keeps reading
`event_time`, unchanged.

*Alternative considered:* a server route that stamps the mark itself. That buys a
trusted column value, which nothing needs once `event_time` comes from `now()`,
at the cost of a new route and a second write path for the board card.

### D3 — The same two-trigger shape, keyed on the mark

`AFTER UPDATE OF meta_qualified_at` and `AFTER INSERT`, both on `deals`, both
calling one `SECURITY DEFINER` function, keeping migration 048's `_upd` / `_ins`
suffixes and its reasons for them — `AFTER INSERT` rather than `BEFORE` because
`meta_capi_events.deal_id` references `deals(id)`, and `SECURITY DEFINER`
because the function reads `accounts`.

The function branches on the transition, not on the value:

| `OLD.meta_qualified_at` | `NEW.meta_qualified_at` | Action |
|---|---|---|
| `NULL` | not null | enqueue (D5) |
| not null | `NULL` | cancel (D4) |
| not null | not null | nothing — the board writes whole rows, and a re-stamp is not a new decision |
| `NULL` | `NULL` | nothing |

`AFTER UPDATE OF <column>` fires whenever the column appears in the `SET` list,
changed or not; the guard above is what makes that harmless, exactly as the
status guard did in 048.

The old `AFTER UPDATE OF status` trigger is dropped. Nothing replaces it: a
status change now records nothing at all.

### D4 — Unmarking updates the outbox row to `canceled`; it never deletes it

`UPDATE meta_capi_events SET status = 'canceled' WHERE deal_id = NEW.id AND
status IN ('pending','unconfigured')`.

*Why not delete:* the row is the only record that this deal was ever marked, and
a delete would let a mark/unmark/mark cycle look identical to a first mark. It
would also throw away the `unconfigured` count an operator uses to justify
configuring the account.

*Why only those two states:* they are the only states that have not left the
system. `sent` is a fact about Meta's side and stays as it is; `sending`,
`failed` and `expired` belong to the delivery pass and are left for it to own,
rather than having a trigger race with a worker over rows it is mid-flight on.

`canceled` joins the `meta_capi_events_status_check` constraint. The delivery
claim query — task 8.1 of the sibling change, not yet written — must exclude it
alongside `unconfigured`; the spec carries that as a requirement so it cannot be
lost between the two changes.

### D5 — Re-marking revives a canceled row through the unique index

```sql
INSERT INTO meta_capi_events (…) VALUES (…)
ON CONFLICT (deal_id, event_name) DO UPDATE SET
  status          = EXCLUDED.status,
  event_time      = EXCLUDED.event_time,
  ctwa_clid       = EXCLUDED.ctwa_clid,
  ctwa_clid_at    = EXCLUDED.ctwa_clid_at,
  attempts        = 0,
  next_attempt_at = now(),
  last_error      = NULL
WHERE meta_capi_events.status = 'canceled';
```

*Why:* 048's `ON CONFLICT DO NOTHING` is correct for a second qualification, but
after D4 it would make the first unmark permanent — the row exists, so the
insert is swallowed, and the card's toggle lies. The `WHERE` narrows the revival
to canceled rows only, so re-marking a deal whose conversion is `sent`,
`pending` or mid-delivery still does nothing, which is what the spec says.

The reset of `attempts` / `next_attempt_at` / `last_error` matters only once
delivery exists: a row that was canceled while carrying a stale error should
restart clean rather than inherit a retry budget from a decision that was undone.

*Alternative considered:* dropping the unique index and keeping one row per
mark. That turns "at most one conversion per deal" from a database guarantee
into an application rule, and the deduplication it protects is the whole point of
a stable `event_id`.

### D6 — The migration cancels the rows the old rule enqueued

One statement: every `pending` row becomes `canceled`. `unconfigured` rows are
left alone — they were never going to be delivered (sibling D3) and they are the
count that motivates configuring an account.

*Why:* `pending` means "will be sent the day delivery ships". Those rows were
written by the rule this change exists to remove, and none of them carries a
decision. Leaving them would mean the first thing delivery ever does is send the
automatic conversions the operator asked us to stop sending.

*Not a dead end:* an operator who does want one of them reported marks that deal
on the card, and D5 revives exactly that row.

*Alternative considered:* backfilling `meta_qualified_at` from
`status = 'qualified'`, which would preserve those rows and mark thousands of
historical deals as decisions nobody made. Rejected for the same reason the
change exists.

### D7 — The control appears only on cards whose contact has a click

`deal.contact?.ctwa_clid` is already loaded (Context, 5). When it is absent the
card offers no control at all.

*Why:* for an organic lead the trigger would record nothing, so the button would
be a switch wired to nothing — the worst kind, because it looks like it worked.

*Edge case, handled by the same rule:* a deal whose contact was deleted has
`contact_id NULL` (`ON DELETE SET NULL`), so no control, and the trigger would
find no click either. The UI and the trigger disqualify the same rows for the
same reason.

*Trade-off:* an operator who expected the control and does not see it learns
nothing about why. The honest fix is a "this lead did not come from an ad" line
on the deal detail view, which is a different surface and out of scope here.

### D8 — The write reuses `updateDealInline`

Its patch type gains `meta_qualified_at?: string | null`. The board page wraps it
in the same optimistic-update-and-revert it already uses for title, value and
schedule.

*Why:* it is the tested shared path for exactly this — a small write to a deal's
own columns from a board card — and RLS on `deals` already decides who may
perform it. A dedicated route or helper would duplicate the revert logic for one
extra field.

*Note for the implementer:* the patch type is deliberately narrow because the
body spreads it straight into `.update()`. Adding the field to that type is the
whole authorization story; there is no allow-list elsewhere to update.

### D9 — On the card: a hover action to toggle, a persistent badge when marked

The toggle joins the existing hover action group (archive, inline edit), gated on
the same `send-messages` capability. The marked state is shown as a badge beside
the `qualified` / `lost` status badge and stays visible without hovering,
because the spec requires a marked deal and a merely qualified one to be
distinguishable at a glance.

The badge uses an icon other than `Check`, which the `qualified` badge already
owns. Labels live under `Pipelines.card` in `messages/en.json` and
`messages/pt-BR.json`, like every other string on this card.

Setting the mark is immediate, with no confirm step: it is reversible in one
click, unlike archiving, which removes the card and therefore keeps its confirm.

### D10 — "Conversion mark" is the term, and the glossary has to say so

This product now has two things an operator could call "qualified": the deal
status, and the decision to report. `CONTEXT.md` defines **Qualification** as the
status transition; it gains **Conversion mark** for the new one, with
_Avoid: qualified, won, conversion flag_.

The column keeps the `meta_` prefix the sibling change established for everything
ad-platform-facing, so `meta_qualified_at` reads as "the mark that feeds Meta"
rather than as a second sales status.

## Risks / Trade-offs

- **Reporting now depends on an operator habit.** A clinic that never marks
  anything reports nothing, and nothing in the product will complain. → The
  operator console's pending count (sibling task 6.1) is where that shows up: an
  account with ad-originated deals and a count stuck at zero is the signal. No
  extra alerting in this change.
- **A clinic user can write any value into `meta_qualified_at`.** → Nothing
  outward-facing reads it; `event_time` comes from `now()` in the trigger (D2).
- **A revived row may carry a click older than seven days.** → Delivery's
  freshness check (sibling task 8.1) marks it `expired`. Nothing to do here, but
  it means a re-mark weeks later is silently unreportable.
- **Two operators toggling the same card at once.** → Last write to the deal
  wins and the trigger follows it; the outbox ends in the state matching the
  final column value. Acceptable for a two-state toggle on one clinic's board.
- **The sibling change's verification steps 7.3 and 7.4 describe the old
  trigger.** → They are rewritten as part of this change's tasks, rather than
  left to read as instructions that no longer work.
- **`canceled` exists before anything can produce the states around it.** The
  delivery pass is still unwritten, so the constraint carries a state whose
  interaction with `sending` / `failed` is reasoned about (D4) but not exercised.
  → Recorded here so the delivery work inherits the reasoning instead of
  rediscovering it.

## Migration Plan

`supabase/migrations/049_meta_capi_manual_mark.sql`, applied by hand in the
Supabase SQL editor like every migration in this project, and idempotent in the
same style (`ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … CREATE`).

Order inside the file matters:

1. `ALTER TABLE deals ADD COLUMN IF NOT EXISTS meta_qualified_at TIMESTAMPTZ`,
   with a `COMMENT` saying it is the operator's reporting decision and is
   independent of `status`.
2. Drop and re-add `meta_capi_events_status_check` with `canceled` included —
   before anything can write the value.
3. `CREATE OR REPLACE FUNCTION meta_capi_enqueue()` with the transition branch
   (D3), the cancel (D4) and the revive (D5).
4. Drop `meta_capi_enqueue_upd`; create it against
   `AFTER UPDATE OF meta_qualified_at`. Recreate `meta_capi_enqueue_ins`
   unchanged in shape.
5. `UPDATE meta_capi_events SET status = 'canceled' WHERE status = 'pending'`
   (D6), last, so it runs under the already-widened constraint.

**Rollback:** re-apply migration 048's function and trigger definitions. The
column and the `canceled` state can stay behind — an unread column and an unused
constraint value cost nothing, and dropping them would destroy the record of
which deals had been marked. The canceled historical rows do not return to
`pending`; that is deliberate, and the same reasoning as D6.

**Deploy order:** the migration first, the UI after. In between, the mark exists
and nothing sets it, which is the correct intermediate state — no conversions are
recorded, which is what the old rule's removal already implies.
