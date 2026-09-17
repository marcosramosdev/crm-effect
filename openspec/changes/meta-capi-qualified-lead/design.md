## Context

See `proposal.md` — Why. Five constraints shape this design, and none of them is
obvious from the outside.

1. **There is no WABA, and there will not be one.** The clinics' numbers run on
   UAZAPI, an unofficial gateway. Meta's documented business-messaging path for
   WhatsApp needs a WhatsApp Business Account ID for both halves — creating the
   dataset (`POST /<WABA_ID>/dataset`) and identifying the conversion
   (`user_data.whatsapp_business_account_id`). Neither input exists.
2. **The Effect's access to a client is an ad account and a Page**, not their
   Business Manager. So nothing can be created inside the client's business, and
   onboarding their number to the Cloud API is not available as a fallback.
3. **Deal status is written from the browser.** `deal-form.tsx`,
   `contact-detail-view.tsx`, `contact-sidebar.tsx`, `message-thread.tsx`, the
   inbox page and the pipeline board all write `deals` directly through
   supabase-js under RLS, and `lib/automations/engine.ts` inserts them
   server-side. No single route sees every status change.
4. **Seven days, hard.** Meta discards a business-messaging event whose click is
   outside the 7-day attribution window. For a clinic whose cycle is "lead
   today, consultation next week", that is the common case.
5. **A cron already exists.** Change 4 shipped `/api/followups/cron`, driven by
   `pg_cron` every 15 minutes with `x-cron-secret`. Delivery costs one more
   function call and no new infrastructure.

### Where each value comes from

| Value | Source | Notes |
|---|---|---|
| `ctwa_clid` | webhook `message.content.contextInfo.externalAdReply.ctwaClid` | Present only on the first message of an ad-started conversation. Meta validates it; it cannot be fabricated. |
| `ad_source_id` | `externalAdReply.sourceID` (e.g. `120250103171390297`) | The creative ID. Stored for diagnosis, never sent to Meta. |
| `meta_dataset_id` | Events Manager, in the **Effect's own Business Manager** — a dataset created there (or an existing Pixel reused), then shared with the client's ad account | **Per account. Not derivable from the webhook.** |
| `meta_access_token` | Events Manager → that dataset → Settings → Conversions API → **Generate access token** | Copied once — Meta does not store it. Stored encrypted. |
| `meta_page_id` | the Page the client's CTWA ads run from (e.g. `61587334015088`, visible in `externalAdReply.mediaURL`) | Diagnostics only. Not sent to Meta — see D4. |
| `event_id` | `deal.id` | Ours, stable across retries. |
| `event_time` | the qualification timestamp | Seconds. The webhook's `messageTimestamp` is milliseconds. |

The `conversionData` / `ctwaPayload` base64 blob in the webhook is Meta's own
encrypted referral payload. We do not decode it and do not need it: `ctwa_clid`
is the documented attribution key.

## Goals / Non-Goals

**Goals:**

- Capture attribution once, at ingestion, and never depend on it being
  re-derivable later.
- Enqueue exactly one conversion per qualified deal, from a place no writer can
  bypass.
- Make every non-delivery — unconfigured, organic, stale, rejected — a counted,
  named state rather than silence.
- Settle the delivery question by experiment before writing a sender.

**Non-Goals:**

- Onboarding any clinic number to the WhatsApp Cloud API.
- A Meta app of our own, and everything that hangs off one: System User tokens,
  Business Verification, App Review, Facebook Login for Business, and an
  in-product "Connect Meta" flow. See D6.
- Reporting any event other than the qualified-lead conversion. No `Purchase`,
  no per-message events.
- Any in-CRM report of which creative converts best. `ad_source_id` is stored so
  that report is possible later; building it is out of scope.
- `external_id` in `user_data`. Without a web Pixel emitting the same identifier
  there is nothing to deduplicate against, so it would be an inert field.

## Decisions

### D0 — Delivery is gated on one experiment, and capture is not

Meta documents `user_data.whatsapp_business_account_id` as required for WhatsApp
business-messaging conversions. It does not document what happens when only
`ctwa_clid` is sent, nor whether a dataset with no WABA behind it accepts a
WhatsApp event at all. Those are the two facts the delivery half rests on, and
neither is answerable from the documentation.

**Setup** (no app, no System User — see D6): create the dataset in the Effect's
Events Manager, or reuse an existing Pixel; share it with the client's ad
account; generate the access token on that dataset; take a test event code from
Test Events. Confirm the token can see the dataset before anything else —
`GET /v23.0/<DATASET_ID>?fields=id,name,owner_business`. An `error.code: 190`
means a bad token; `100` / `#803` means the token and the dataset sit under
different Business Managers. Either failure says nothing about the real
question, so fix it first.

**The probe:** one event with a real, fresh `ctwa_clid`, `event_name: "Lead"`,
`action_source: "business_messaging"`, `messaging_channel: "whatsapp"`,
`partner_agent: "effect_crm_1_0"`, no WABA ID, and the test event code.

**`{"events_received":1}` is not a pass.** Meta returns it for events accepted at
the envelope and then dropped. The pass condition is the event appearing in
Events Manager → the dataset → Test Events within about a minute.

| Outcome | Verdict |
|---|---|
| visible in Test Events | delivery is specified and built |
| `events_received: 1`, nothing in Test Events after 5 minutes | accepted and silently discarded — treated as rejection, and the worst case, because in production it would look like success |
| `400` | delivery leaves this change's scope; Meta's `error_subcode` is recorded here as the reason |

**Two controls make the verdict mean something**, and cost a minute: repost with
a garbage `ctwa_clid`, and repost with `messaging_channel` removed. If the
garbage click is also "accepted" and the malformed event does not error, the
dataset is a black hole and the apparent success is not one.

*Why gate:* none of the sender survives a change of identity model — `user_data`
changes shape, the dataset's owner changes. Writing it before the answer means
writing it twice.

*Why not gate capture:* a click not stored today is gone. Capture is identical
under all outcomes, it is the cheap half, and the probe needs a stored click to
run at all — so capture ships first.

### D1 — A database trigger writes an outbox row; nothing calls Meta inline

One `plpgsql` function behind two triggers on `deals`: `AFTER UPDATE OF status`
and `AFTER INSERT`. It fires when the deal is `qualified` and was not before,
and snapshots the contact's `ctwa_clid` / `ctwa_clid_at` and the account's
`meta_event_name` at the moment of the transition.

*Why:* it is the only choke point that covers the browser writers (constraint 3)
without touching six components, and the snapshot means a later ad click on the
same contact cannot rewrite what was already reported.

*Alternatives:* calling the API from each UI writer (misses writers, blocks the
user, leaks the token to the browser — disqualified); a Supabase webhook per row
(more moving parts than the cron already running); `pg_net` calling Meta from
the trigger (no retry accounting, no access to the encrypted token in SQL).

The unique index is `(deal_id, event_name)` — it makes "re-qualifying does not
duplicate" a database guarantee rather than an application convention. See D9
for the four implementation details that are load-bearing.

### D2 — Three outcomes at enqueue time, and only one of them is silence

| At the moment of qualification | Row written |
|---|---|
| contact has no `ctwa_clid` (organic) | none |
| contact has a click, account has `meta_dataset_id` | `pending` |
| contact has a click, account has no `meta_dataset_id` | `unconfigured` |

*Why `unconfigured` is a row:* it is the count that tells an operator how much
attribution a clinic is losing by not being configured, and while D0 is
unresolved it is the only observable output of this change.

*Why organic is not a row:* it is not a failure and it is the majority of deals;
counting it would fill the table with inert rows. "How many qualified leads came
from ads" is `contacts.ctwa_clid IS NOT NULL`, not an outbox query.

### D3 — `unconfigured` rows are historical; they never revive

Configuring an account later does not move its `unconfigured` rows to `pending`.

*Why:* almost all of them have clicks older than seven days by then, so reviving
them produces a burst of `expired` rows that buries the count that motivated the
configuration in the first place. The few still inside the window do not justify
a recovery pass.

*Where it lives in the code:* `'unconfigured'` is simply absent from the claim
query's status list. That single absence is this decision, and it is invisible
without a comment saying so.

### D4 — The payload carries the click and nothing else identifying

`user_data` is `ctwa_clid` alone (plus `ph` when D5's flag is on). No
`whatsapp_business_account_id` — constraint 1 says it will never exist. No
`page_id`: business-messaging identity by Page is the Messenger path, and this
is a WhatsApp event.

`accounts.meta_page_id` is therefore **operator diagnostics, not identity** — it
answers "which Page do this account's ads run from" when someone is working out
why a dataset sees no events. It is never sent to Meta. Keeping the column is
worth one nullable text field; leaving its purpose unstated would send the next
reader hunting for the code that sends it.

The previously planned `meta_waba_id` is dropped outright.

### D5 — `ph` ships behind a per-account flag, defaulting off

`accounts.meta_send_ph BOOLEAN NOT NULL DEFAULT false`. When true, delivery adds
`user_data.ph` — `sha256(normalizePhone(contacts.phone))`, reusing
`src/lib/whatsapp/phone-utils.ts:15`, which already stores digits-only numbers in
the format Meta expects. The hash is computed at send time and never persisted.

*Why a flag rather than always-on:* consent is per clinic. A boolean is cheaper
than discovering later that an account sent patient phone numbers without a
basis to do so.

*Why not persisted:* the click is snapshotted because a newer click overwrites an
older one; a phone number has no such problem, and the current value is always
the more correct one. Persisting the hash would create another place in the
database — with its backups, replicas and dumps — where a derivative of a
patient's phone number lives.

*What it buys:* not measurable here. Event match quality is a web-only metric, so
there is no score to watch move, and `ctwa_clid` is already an exact identifier
rather than a probabilistic one. This is included because it was asked for, with
the uncertainty stated rather than hidden.

*Known ceiling:* Brazilian numbers recorded before the ninth-digit change hash to
something Meta will never match, and the failure is silent. `phonesMatch()` in
the same module already compares the last eight digits because the codebase knows
numbers arrive in inconsistent shapes. Noted as a `ponytail:` comment in the
payload builder, not handled.

### D6 — No Meta app; the token comes from Events Manager

Meta's Conversions API guide describes a Business Messaging Partner integration:
a developer app, `whatsapp_business_management` + `whatsapp_business_manage_events`
at Full Access, Business Verification, and Embedded Signup or Facebook Login for
Business to collect each client's token. None of that is built here.

*Why not:* App Review for the WhatsApp permissions requires demonstrating a
WhatsApp Business Platform integration, and this product's gateway is
unofficial — there is nothing to demonstrate. Tech Provider access also requires
control of the client's Business Manager, which constraint 2 rules out. And it
is unnecessary: a token generated in Events Manager against a dataset needs no
app, no System User and no review, and Meta documents it as a supported way for
a partner to send events.

*What this costs:* the token is bound to the person who generated it and to that
dataset. If their access changes, it stops working, and the failure surfaces as
a permanent OAuth rejection on the outbox row (D8) rather than as anything
proactive. Acceptable at the current number of accounts; the trigger to
reconsider is either many accounts or a token expiring unnoticed.

*What is explicitly deferred:* the in-product "Connect Meta" flow — client signs
in, picks their dataset, the CRM stores the grant. That is the SaaS shape, it
needs the app and the review this decision avoids, and nothing about the schema
here blocks it later.

### D7 — Operators edit the configuration through `/admin`, reusing the existing gate

`src/lib/provisioning/platform-admins.ts` already implements the allow-list
(`PLATFORM_ADMINS`, a non-`NEXT_PUBLIC_` env var), checked in middleware and
re-checked in `src/app/api/admin/provision/route.ts`. The edit path is a new
route with the same double check — and the re-check is not decoration: the
middleware guards paths starting with `/admin`, which does not cover
`/api/admin`.

*Why not a field in the clinic's own settings screen:* the operator is an Effect
traffic manager, not clinic staff. Putting the field there means either exposing
the columns that migration 046 deliberately revoked, or having the operator sign
in as the client.

Writes go through the service-role client, not the operator's session: the
`accounts` policies are membership-based and an Effect operator is not a member
of the client's account, so a session-scoped update would silently match zero
rows.

### D8 — Setup is a written checklist, because code cannot verify the campaign

Nothing the CRM can do proves the ad set optimizes for the event it sends. The
operator screen carries the procedure:

1. In the Effect's Events Manager, create a dataset for this clinic — or reuse
   an existing Pixel of theirs, noting which Business Manager owns it.
2. Share the dataset with the client's ad account.
3. On that dataset: Settings → Conversions API → Generate access token. Copy it
   once; Meta does not store it.
4. Fill dataset ID, token, Page ID and `meta_test_event_code` on the account.
5. Qualify one real deal that came from an ad; watch it appear in Test Events.
6. Clear the test code. Only then do events count for optimization — an account
   left in test mode reports nothing while looking perfectly configured.
7. In Ads Manager, the ad set's performance goal must be the event this account
   reports (`meta_event_name`), with conversion location WhatsApp. A mismatch
   here produces zero errors on our side and zero optimization on theirs.

### D9 — Legal precondition for `meta_send_ph`

Holding a patient's phone number to run the clinic's conversations is one
purpose; sending a hash of it to an ad platform for campaign optimization is
another, and needs its own basis under LGPD art. 6. A hash is pseudonymization,
not anonymization — matching against Meta's own hashed table is the entire point
— so the hashed value remains personal data. The clinic in the reference payload
is a neurology practice, which makes "this person contacted this clinic" an
inference about health, engaging art. 11.

The flag therefore ships `false` and stays `false` for an account until that
account's opt-in or privacy policy covers the sharing. The code is ready; the
switch is an operator decision with a written basis behind it. Recorded as a
precondition, not as a blocker on the change.

### D10 — Inbound `content` arrives as an object *or* a JSON string

UAZAPI's own schema declares the field as
`oneOf: [object, string]` — "Conteúdo bruto da mensagem (JSON serializado ou
texto)" (`uazapi-openapi-spec.yaml:591-597`).

So the field is typed `unknown` and narrowed in one exported pure function that
JSON-parses the string form before walking `contextInfo.externalAdReply`. A
nested-object type would be a lie on the gateway versions that send the string,
and the failure mode is the silent one: nothing stored, no error raised.

The same function is the unit under test for the capture scenarios, which is
much cheaper than driving each of them through the webhook route.

Capture also skips the write when the stored click already equals the incoming
one. UAZAPI redelivers messages, and without that guard every redelivery pushes
`ctwa_clid_at` forward and quietly extends the seven-day window past its real
end.

### D11 — Schema

```sql
-- contacts: ad attribution, last click wins
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ctwa_clid     TEXT,
  ADD COLUMN IF NOT EXISTS ad_source_id  TEXT,
  ADD COLUMN IF NOT EXISTS ctwa_clid_at  TIMESTAMPTZ;

-- accounts: advertising configuration. meta_dataset_id and
-- meta_access_token already exist, from migration 046.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS meta_page_id         TEXT,
  ADD COLUMN IF NOT EXISTS meta_event_name      TEXT NOT NULL DEFAULT 'Lead',
  ADD COLUMN IF NOT EXISTS meta_test_event_code TEXT,
  ADD COLUMN IF NOT EXISTS meta_send_ph         BOOLEAN NOT NULL DEFAULT false;

-- outbox
CREATE TABLE IF NOT EXISTS meta_capi_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL,
  event_time      TIMESTAMPTZ NOT NULL,
  ctwa_clid       TEXT NOT NULL,
  ctwa_clid_at    TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  attempts        INT  NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meta_capi_events_status_check CHECK (
    status IN ('pending','unconfigured','sending','sent','failed','expired')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS meta_capi_events_deal_event_uniq
  ON meta_capi_events (deal_id, event_name);
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_due
  ON meta_capi_events (next_attempt_at) WHERE status IN ('pending','sending');
CREATE INDEX IF NOT EXISTS idx_meta_capi_events_account_status
  ON meta_capi_events (account_id, status);
```

All six states are in the CHECK from the start, so adding delivery is not a
second migration against a live table. While this change is capture-only, only
`pending` and `unconfigured` occur.

RLS is enabled with **zero policies**. Supabase grants new public tables to
`authenticated` by default, so RLS-with-no-policy is what makes the table
service-role-only; a policy added here would leak `ctwa_clid`, which Meta treats
as personal data.

The four new `accounts` columns are **not** added to the `GRANT SELECT` column
list that migration 046 narrowed the table to. Migration 047 does the opposite a
few lines away, for columns that are client-readable, so the omission needs a
comment saying it is deliberate.

**Four details in the trigger are load-bearing:**

- **`SECURITY DEFINER`** (with `SET search_path = public`). The trigger runs as
  the writer, which is `authenticated` for every browser writer. Migration 046
  revoked `SELECT ON accounts` from that role, so reading `meta_dataset_id`
  inside the trigger raises `permission denied for table accounts`, and the
  insert into an RLS-no-policy table is refused too. Without it, every drag of a
  card to Qualified fails in the browser. Precedent: `run_followups_tick()` in
  047.
- **`AFTER INSERT`, never `BEFORE INSERT`.** `meta_capi_events.deal_id`
  references `deals(id)`; in a `BEFORE INSERT` trigger that row does not exist
  yet, the foreign key check fails, and the deal insert aborts. `AFTER INSERT`
  has identical semantics here — `NEW.id` is already populated by the column
  default.
- **Guard the unchanged status.** `AFTER UPDATE OF status` fires whenever the
  column appears in the `SET` list, changed or not, and the pipeline board
  writes whole rows. Skip unless the status actually became `qualified`.
- **`ON CONFLICT DO NOTHING` plus an exception block.** Letting the unique index
  raise would abort the user's own `UPDATE`; an outbox bug must never cost the
  clinic a status change. The cost is a silently lost row, logged as a warning —
  the alternative is a broken pipeline board.

Because two triggers cannot share one name on one table, they take `_ins` and
`_upd` suffixes, deviating from 047's function-and-trigger-same-name convention.

## Risks

- **The experiment fails.** Then this change delivers capture and a counter, and
  the business question — whether an unofficial-gateway setup can report
  conversions at all — is answered with an error code instead of a guess. The
  stored clicks are not wasted; they are the input to whatever path comes next.
  Note that `pending` rows would then never expire, because the expiry check
  lives in the delivery pass that would not exist: `pending` would mean "waiting
  on a decision", not "waiting on a cron".
- **The ad set optimizes for a different event.** Zero errors here, zero
  optimization there. Only D8 step 7 catches it, and only if someone reads it.
- **`meta_send_ph` is switched on without the consent text.** Mitigated by the
  default and by D9 sitting next to the switch rather than in a ticket.
- **The Events Manager token dies with its author's access.** Surfaces as a
  permanent rejection on the outbox row, visible in the operator counters, not
  before.
- **Deleting a deal erases the record that its conversion was reported**
  (`ON DELETE CASCADE` on `deal_id`). Right for privacy, lossy for audit;
  `SET NULL` is unavailable because `deal_id` is half the unique key.
