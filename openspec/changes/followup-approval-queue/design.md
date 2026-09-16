## Context

See `proposal.md` — Why. This section records only the parts of the existing
system that shape the approach.

- **Outbound sending is already one function.** `sendMessageToConversation(db,
  accountId, params)` in `src/lib/whatsapp/send-message.ts` validates the
  payload, resolves the conversation and contact account-scoped, sends
  interactive reply-buttons through `sendInteractiveButtons()`, retries across
  Brazilian phone-number variants, persists the `messages` row and bumps the
  conversation. Releasing a follow-up is one call to it; there is no second
  send path to build or to guard.
- **Interactive replies already arrive parsed.** The webhook's
  `parseMessageContent()` returns `interactiveReplyId` (from UAZAPI's
  `buttonOrListid`), stores it on `messages.interactive_reply_id`, and hands it
  to flows and automations. The button id is the only reliable signal — the
  visible label arrives as ordinary `contentText`.
- **Inbound is already idempotent.** The upsert on
  `(conversation_id, message_id)` with `ignoreDuplicates` returns zero rows on a
  gateway redelivery and the handler returns early. Anything placed *after*
  that early return inherits exactly-once handling for free.
- **Two cron endpoints already exist.** `/api/automations/cron` and
  `/api/flows/cron` are `GET` routes that compare `x-cron-secret` against
  `AUTOMATION_CRON_SECRET` with `timingSafeEqual`, guarded by a length
  pre-check. They are currently driven by an external pinger.
- **`accounts` carries per-account settings already.** `timezone` (change 1) and
  the encrypted Meta credentials (change 3) live there. Migration 046 revoked
  blanket `SELECT` on the table from `authenticated` and granted a named column
  list instead; `accounts_update` is `is_account_member(id, 'admin')`.
- **The AI draft path is complete.** `/api/ai/draft` builds conversation
  context, retrieves knowledge, calls `buildSystemPrompt({ userPrompt, mode,
  style, knowledge })` with `mode: "draft" | "auto_reply"` and a style from
  `ai_configs.followup_style`, generates, and logs usage. The CFM guardrails are
  in the fixed scaffold and already state that they apply to generated
  follow-ups.
- **Settings has a `deals` section.** `SETTINGS_SECTIONS` in
  `src/components/settings/settings-sections.ts` already contains `deals`,
  reachable at `/settings?tab=deals`.
- **`notifications` is per-recipient.** One row per `user_id`, `type` locked by
  a `CHECK` to `conversation_assigned`, RLS `auth.uid() = user_id`, rows written
  only by a `SECURITY DEFINER` trigger. It is a *notification* table, not a work
  queue.
- **Deals are account-scoped.** `deals.account_id` is `NOT NULL` since migration
  017; `is_account_member(account_id, min_role)` is the RLS helper.
- **Migrations are applied by hand** in the Supabase SQL editor — the repository
  has no migration runner in CI.

## Goals / Non-Goals

**Goals:**

- Make "nothing sends itself" a structural property, not a policy: no code path
  outside an authenticated human action calls the gateway for a follow-up.
- Reuse the send, parse, draft and cron machinery that already exists; add a
  table and a route, not a subsystem.
- Keep the reviewer's approval bound to the exact text they read.
- Survive a cron outage, a gateway failure, and a gateway redelivery without
  double-sending or losing a human decision.

**Non-Goals:**

- A generic job scheduler. This is one table with one sweep.
- Any queue state machine richer than the five states the spec names.
- Historical appointment tracking. One appointment per deal, as change 1 chose.
- Throughput engineering. A clinic books tens of appointments a week.

## Decisions

### D1 — One table, states as data, no "send at" column

`followup_messages`:

| column | purpose |
|---|---|
| `id` | pk |
| `account_id` | tenancy, `NOT NULL`, FK `accounts` |
| `deal_id` | FK `deals` `ON DELETE CASCADE` |
| `conversation_id` | FK `conversations`, resolved at preparation |
| `offset_minutes` | which configured offset this row is for |
| `body` | the rendered text, frozen (D5) |
| `status` | `pending` / `approved` / `sent` / `rejected` / `expired` |
| `appointment_confirmed` | boolean flag written by D8, not a status |
| `decided_by` / `decided_at` | who approved or rejected, and when |
| `sent_at`, `whatsapp_message_id`, `last_error` | delivery outcome |
| `created_at`, `updated_at` | audit |

`UNIQUE (deal_id, offset_minutes)` is what makes preparation idempotent — the
spec's dedupe rule is a database constraint, not a query the cron has to get
right. `ON CONFLICT DO NOTHING` on insert.

Deliberately absent: any `send_at`/`scheduled_for` column. A row carries no
instruction to send. The only thing that sends is the approve/send route, and
the only thing that calls it is a signed-in member.

RLS: `SELECT` for `is_account_member(account_id)` — read-only members see the
queue, per the spec. `UPDATE` for `is_account_member(account_id, 'agent')` with
the same predicate in `WITH CHECK`. No client `INSERT` or `DELETE` policy;
rows are written by the service role in the cron.

*Alternative rejected:* a status column plus a `send_after` timestamp, so a
worker could drain it. That is exactly the design the change exists to avoid —
it makes automatic sending a one-line change away.

### D2 — The cron materialises and expires; it never sends

`GET /api/followups/cron`, same `timingSafeEqual` secret check as
`/api/flows/cron`, same `AUTOMATION_CRON_SECRET`. Two passes:

1. **Materialise.** For each account, for each configured offset, insert a
   `pending` row for every deal where
   `scheduled_at - offset <= now() < scheduled_at`, the deal is not archived and
   its status is not `lost`. `ON CONFLICT (deal_id, offset_minutes) DO NOTHING`.
2. **Expire.** Move every row with `status IN ('pending','approved')` whose
   deal's `scheduled_at` has passed to `expired`. `approved` is included so a
   permanently failing send does not sit in the queue forever.

The module imports nothing from `src/lib/whatsapp/`. That import boundary is
the mechanical statement of "the cron cannot send", and is worth a test that
asserts it.

No catch-up window: a row is materialised only while the offset's moment is in
the past *and* the appointment is in the future. A multi-day cron outage
therefore silently drops the offsets it slept through, which is the right
failure for a reminder — a "your appointment is in 5 days" message sent three
days late is worse than no message.

### D3 — `pg_cron` + `pg_net`, with both secrets in Supabase Vault

Migration 047 creates a `SECURITY DEFINER` function that reads
`followup_cron_url` and `followup_cron_secret` from `vault.decrypted_secrets`
and issues `net.http_get` with the `x-cron-secret` header, then schedules it
with `cron.schedule('followups-tick', '*/15 * * * *', …)`.

- **Vault, not a literal, not a table.** The repository never carries the
  deployment URL or the shared secret, and nothing in `public` can read them.
- **When a secret is missing** the function raises a notice and returns without
  calling out. A half-configured deployment does nothing rather than hammering
  the wrong URL.
- **15 minutes.** The tightest default offset is 2 hours, so a quarter-hour of
  granularity is invisible to a lead, and the sweep touches only deals with a
  future appointment. Alternatives: every 5 minutes (12× the load for no
  observable difference), hourly (a 2-hour offset could land at 1h00).

Because the endpoint is an ordinary authenticated `GET`, a deployment without
`pg_cron`/`pg_net` can drive it from the same external pinger that already
drives the other two crons, with no code change. That is the documented
fallback, not a second implementation.

### D4 — Settings on `accounts`, not a new table

Three columns on `accounts`:

- `followup_offsets INTEGER[] NOT NULL DEFAULT '{7200,1440,120}'` — minutes
  before the appointment, `CHECK (cardinality <= 3 AND all > 0 AND no duplicates)`.
- `followup_reminder_template TEXT NOT NULL DEFAULT '<pt-BR default>'`.
- `stale_lead_days INTEGER NOT NULL DEFAULT 15 CHECK (> 0)`.

`accounts_update` is already admin-only, which is exactly the spec's rule, and
`accounts_select` already covers every member — so the only schema work beyond
the columns is adding the three names to migration 046's column-level
`GRANT SELECT`. Zero new policies, zero new tables, zero new client plumbing.

*Alternatives rejected:* a `followup_settings` table (a new table, new RLS, a
new join, to hold three scalars); `ai_configs` (it is per-account and already
holds `followup_style`, but a reminder template is not an AI setting and the
name would mislead every future reader).

Editing surface: the existing `deals` settings section — appointments are a
deal attribute and that section already exists. No new settings section.

Template-placeholder validation is one shared function in
`src/lib/followups/template.ts`, used by both the settings form and the
renderer, so the set of legal placeholders is defined once.

### D5 — The body is rendered once, at preparation time

`followup_messages.body` is written when the row is created and never
re-rendered. The reviewer approves a specific string and that exact string is
what `sendMessageToConversation` receives.

Re-rendering at send time would mean an admin editing the template, or a lead
changing their name, silently rewriting a message a human already read and
approved. In a clinical context that breaks the whole premise of the review.

Rendering happens in TypeScript (`src/lib/followups/render.ts`) rather than in
SQL: `{data}` and `{hora}` are produced with `Intl.DateTimeFormat` under
`accounts.timezone`, matching how the calendar from change 1 formats the same
instant. One formatting rule, one place.

### D6 — `{medico}` resolves from a deal custom field

The schema has no professional column and adding one for a placeholder is not
worth a migration. `{medico}` reads the deal's custom-field value whose field
key is `medico` in the account's `deal_custom_fields` catalogue (migration 042),
and renders empty when the account has no such field or the deal left it blank.

*Alternative rejected:* the deal's owner. In a clinic the deal owner is the
receptionist who created it, not the doctor the lead is seeing — the placeholder
would be confidently wrong, which is worse than empty.

### D7 — Approve records, then sends; the status guard is the concurrency control

The approve/send route (`POST /api/followups/[id]`, action `approve` |
`reject` | `edit_and_send`):

1. Conditional update `status = 'approved'` filtered by `.eq("status",
   "pending")`, returning the row. **Zero rows returned means someone else
   already decided** — refuse with a conflict. This is the same optimistic guard
   `/api/flows/cron` uses on `flow_runs`, not a new pattern and not a lock.
2. Call `sendMessageToConversation` with the interactive-buttons payload.
3. On success: `status = 'sent'`, `sent_at`, `whatsapp_message_id`. On failure:
   leave `status = 'approved'`, write `last_error`, return the error. The human
   decision survives a gateway outage and the row stays releasable.

`edit_and_send` writes the edited `body` inside step 1's update, so the stored
body is always what was delivered. `reject` is step 1 with `status = 'rejected'`
and no step 2.

### D8 — The button id carries the follow-up id

Button ids are `fu:<followup_id>:confirm` and `fu:<followup_id>:reschedule`
(≈50 characters, well inside the limit). Routing reads the id, never the label,
which is what makes the spec's "typed text is not a button press" scenario true
by construction — typed text arrives with `interactive_reply_id = NULL`.

Carrying the id means routing needs no lookup table and no guessing about which
reminder was answered when several are outstanding. The handler loads the
follow-up and ignores the reply unless its `account_id` matches the webhook
config's account.

**Confirm** stamps `deals.appointment_confirmed_at` (idempotently — only when
currently null) and sets `appointment_confirmed = true` on the deal's remaining
`pending` rows. That is a flag, not a status: the spec requires the rows stay
pending and a human still decides.

**Reschedule** raises the notification of D10 and touches no deal column.

### D9 — Where the webhook hook goes

The routing call is placed after the duplicate-insert early return and after the
`bump_conversation_on_inbound` RPC, and runs *alongside* the existing flow and
automation dispatch — it never sets `flowConsumed`. Consequences, all required
by the inbox spec delta:

- **Idempotent for free.** A redelivery never reaches this code, because the
  handler already returned at the upsert.
- **Nothing is swallowed.** Automations that trigger on `interactive_reply`
  still fire; unread count and last-message preview are already updated by the
  RPC above.
- A failure in routing is caught and logged, never propagated — a follow-up
  bookkeeping error must not cost the account an inbound message.

### D10 — The reschedule notification reuses `notifications`

Extend the `type` `CHECK` with `followup_reschedule` and insert one row per
account member holding `agent` or above, carrying the conversation id so the
existing notifications page can already open the thread. A clinic has one to
three such members, so fan-out is trivial.

*Alternative rejected:* notify only `conversations.assigned_agent_id`. Most
clinic conversations are never assigned, so the notification would frequently
have no recipient.

The pending-approval queue itself is **not** a notification: it is a separate
section on `/notifications` reading `followup_messages` directly. The queue is
account-wide shared work, while a `notifications` row is one person's. Forcing
the queue into that table would mean N rows per follow-up and N read-states for
one decision.

### D11 — The AI follow-up reuses `/api/ai/draft`

Add `mode: "followup"` to the route's request body and to
`buildSystemPrompt`'s `mode` union, plus an optional per-request `style` that
falls back to `ai_configs.followup_style`. Everything else — context building,
knowledge retrieval, the CFM guardrails, usage logging, both rate limits — is
already there and unchanged.

The route already returns text and sends nothing, which is exactly the spec's
"drafting never sends". An empty conversation returns `422` rather than
generating from nothing.

*Alternative rejected:* a new `/api/followups/draft` route. It would duplicate
config loading, retrieval, guardrails, usage logging and rate limiting to change
one string in the prompt.

### D12 — The reactivation list is a query, not a table

A tab inside `/pipelines` running one Supabase query: `deals` joined to
`conversations`, filtered on `conversations.last_message_at < now() - <days>`,
optionally by `stage_id`, optionally by the presence of a future
`deals.scheduled_at`, with `{ count: "exact" }` for the badge. Default days =
`accounts.stale_lead_days`.

```
// ponytail: one filtered query per tab open, no materialised view.
// Fine at clinic scale (hundreds of deals); revisit if an account
// ever crosses ~50k deals.
```

Actions on the list are per-lead only — open the conversation, or draft an AI
follow-up for that one lead. There is no multi-select, which is how the spec's
"there is no bulk send" stays true.

## Risks / Trade-offs

- **The cron stops and nobody notices; reminders silently stop being prepared.**
  → The pending-approval section shows when preparation last ran successfully,
  so a stale timestamp is visible on the page people already open. Preparation
  also fails safe: it prepares nothing rather than preparing wrongly.
- **A multi-day outage drops the offsets it slept through** (D2, no catch-up
  window). → Accepted deliberately: a late reminder is worse than none. The
  appointment itself is untouched and the lead is visible on the calendar.
- **`pg_cron` or `pg_net` is unavailable in the target deployment.** → The
  endpoint is a plain authenticated `GET`; the external pinger that already
  drives the other two crons drives this one with no code change. The migration
  guards its `cron.schedule` so a database without the extensions still applies.
- **A burst of pendings when an account first switches this on** — every deal
  whose 5-day mark has already passed materialises on the first tick. → They are
  *pendings*, not sends: the blast radius is a long list a human triages, and
  anything they ignore expires on its own.
- **An approved row whose send keeps failing stays approved.** → It expires with
  the appointment (D2, pass 2) and `last_error` is shown in the queue, so the
  reviewer sees why rather than assuming it went out.
- **Two agents approving at once.** → The conditional status update (D7) makes
  the loser a no-op, so the lead gets exactly one message. The cost is an
  occasional "already decided" conflict message, which is the correct thing to
  show.
- **A deal is deleted with follow-ups outstanding.** → `ON DELETE CASCADE` takes
  the rows with it; a queue entry for a deal that no longer exists is not
  reviewable work.
- **Widening `accounts` is a schema commitment.** Three more columns on a hot
  table, and the column-level `GRANT` from migration 046 must be kept in step or
  the client silently loses read access to them. → Called out in the tasks; a
  test that reads the three columns through an ordinary member session catches a
  forgotten grant.
- **`{medico}` renders empty when the account never created the custom field.**
  → The spec makes empty the defined behaviour, and the settings screen states
  which field key the placeholder reads, so the account can create it.
- **A lead confirms, then the account sends the two later reminders anyway.** →
  By design: a human decides, and the confirmation flag is shown next to those
  rows so the decision is informed.

## Migration Plan

1. Apply `supabase/migrations/047_followup_queue.sql` by hand in the Supabase
   SQL editor. It is idempotent: every object uses `IF NOT EXISTS` or
   `DROP … CREATE`, and the `cron.schedule` block is skipped when `pg_cron` or
   `pg_net` is absent. Re-run it once to confirm.
2. Create the two Vault secrets (`followup_cron_url` pointing at
   `<deployment>/api/followups/cron`, `followup_cron_secret` holding the value
   of `AUTOMATION_CRON_SECRET`). Until they exist the job ticks and does
   nothing, which is the intended pre-configuration state.
3. Deploy the application. With no accounts configured yet, every account picks
   up the default offsets, template and threshold from the column defaults —
   but nothing sends, because sending requires a person.
4. Verify on one test account: book a lead far enough ahead, force a tick, and
   confirm exactly three pending rows with correctly rendered bodies and no
   outbound message.

**Rollback:** `SELECT cron.unschedule('followups-tick');` stops all preparation
immediately. Existing pending rows stay reviewable and expire with their
appointments; nothing sends on its own in the meantime. The table and the
`accounts` columns can be left in place — they are inert without the tick — so
rollback needs no destructive statement.
