## Context

See `proposal.md` — Why. What shapes this design is four constraints that are
not obvious from the outside:

1. **There is no Pixel here.** Business-messaging conversions are posted to a
   *dataset* attached to the clinic's WhatsApp Business Account (WABA), not to a
   web Pixel. Meta's required customer information for these events is
   `whatsapp_business_account_id` + `ctwa_clid`. Nothing in the UAZAPI webhook
   contains a dataset ID, a WABA ID, or a Pixel ID — the payload gives us the
   click (`contextInfo.externalAdReply.ctwaClid`) and the creative
   (`externalAdReply.sourceID`, `sourceURL`, `sourceApp`), and that is all it
   can give us. The dataset is obtained once per clinic, out of band, and stored
   on `accounts`.
2. **Deal status is written from the browser.** `deal-form.tsx`,
   `contact-detail-view.tsx`, `contact-sidebar.tsx` and the pipeline board all
   write `deals` directly through supabase-js under RLS. There is no server route
   that every status change passes through.
3. **Seven days, hard.** Meta discards a business-messaging event whose
   `event_time` is in the future or whose click is outside the 7-day attribution
   window. For a clinic whose sales cycle is "lead today, consultation next
   week", this is a routine outcome, not an edge case.
4. **A cron already exists.** Change 4 shipped `/api/followups/cron`, driven by
   `pg_cron` + `pg_net` with `x-cron-secret`, running the materialize and expire
   passes. Adding a third pass costs one function call and no new infrastructure.

### Where each value comes from

| Value | Source | Notes |
|---|---|---|
| `ctwa_clid` | webhook `message.content.contextInfo.externalAdReply.ctwaClid` | Present only on the first message of an ad-started conversation. Meta validates it; it cannot be fabricated. |
| `ad_source_id` | `externalAdReply.sourceID` (e.g. `120250103171390297`) | The ad/creative ID. Stored for diagnosis, not sent to Meta. |
| `dataset_id` | `POST /v23.0/<WABA_ID>/dataset` (idempotent — returns the existing one), or Events Manager → the dataset linked to the WhatsApp account | **Per clinic. Not derivable from the webhook.** One dataset per WABA, enforced by Meta. |
| `whatsapp_business_account_id` | Meta Business Settings → WhatsApp accounts, or the same Graph call | Numeric. |
| `access_token` | System User token in the clinic's Business Manager, with `whatsapp_business_management` + `whatsapp_business_manage_events` | Long-lived. Stored encrypted. |
| `event_id` | `deal.id` | Our own, stable across retries. |
| `event_time` | the qualification timestamp | Must be ≤ now and within 7 days of the click. |

The `conversionData` / `ctwaPayload` base64 blob in the webhook is Meta's own
encrypted referral payload. We do not decode it and do not need it: `ctwa_clid`
is the documented attribution key.

## Goals / Non-Goals

**Goals:**

- Capture attribution once, at ingestion, and never depend on it being
  re-derivable later.
- Fire exactly one conversion per qualified deal, from a place no writer can
  bypass.
- Make every non-delivery — unconfigured, organic, stale, rejected — a counted,
  named state rather than silence.
- Give the operator a written, verifiable setup procedure, including a test mode
  that proves the wiring before the account goes live.

**Non-Goals:**

- Reporting any event other than the qualified-lead conversion. No `Purchase`,
  no per-message events, no `event_source_url`.
- Creating or managing the dataset from inside the CRM. The operator does that
  once in Events Manager or with a single Graph call.
- Any in-CRM report of which creative converts best. `ad_source_id` is stored so
  that report is possible later; building it is out of scope.
- Hashed PII enrichment (`ph`, `em`). `ctwa_clid` alone is the documented match
  key for business messaging, and sending patient phone numbers to an ad
  platform is not something to do casually in a healthcare product.

## Decisions

### D1 — A database trigger writes an outbox row; nothing calls Meta inline

`AFTER UPDATE OF status ON deals`, when `NEW.status = 'qualified'` and
`OLD.status <> 'qualified'`, insert into `meta_capi_events`. The trigger reads
the contact's `ctwa_clid` / `ctwa_clid_at` and the account's `meta_dataset_id`,
and inserts nothing when the click or the dataset is missing.

*Why:* it is the only choke point that covers the browser writers (constraint 2)
without touching five components, and it snapshots the click at transition time
so a later overwrite of the contact's attribution cannot rewrite history. A
`BEFORE INSERT` counterpart covers deals created directly as `qualified`.

*Alternatives:* calling the API from each UI writer (misses writers, blocks the
user, leaks the token to the browser — disqualified); a Supabase webhook per row
(more moving parts than the cron we already run); `pg_net` calling Meta straight
from the trigger (no retry accounting, no encrypted-token access in SQL).

The unique index is `(deal_id, event_name)` — it is what makes "re-qualifying
does not duplicate" a database guarantee rather than an application convention.

### D2 — The sender is a third pass on the existing follow-up cron

`/api/followups/cron` gains `deliverCapiEvents(admin)` after materialize and
expire. It claims up to N pending-and-due rows per tick with a conditional
update (`status = 'pending' AND next_attempt_at <= now()` → `sending`), so
overlapping ticks cannot both claim the same row.

*Why:* zero new infrastructure, and the cron secret, the `pg_cron` schedule and
the tick-state row all already exist.

*Trade-off:* conversion latency equals the cron interval. Irrelevant — Meta
attributes on `event_time`, not on arrival time.

### D3 — Freshness is checked before the HTTP call

During the claim pass, a row whose `event_time - ctwa_clid_at > 7 days` (or whose
`event_time` is in the future) goes straight to `expired` with
`error = 'ctwa_clid outside 7-day attribution window'`. No request is made.

*Why:* it turns the single most likely reason for "the campaign isn't learning"
into a number on `/admin` instead of a pile of identical 400s. A clinic seeing
40% expired knows its sales cycle is longer than Meta's window — a business
finding, not a bug.

### D4 — Request shape

```http
POST https://graph.facebook.com/v23.0/<meta_dataset_id>/events
Content-Type: application/json
```

```json
{
  "data": [
    {
      "event_name": "Lead",
      "event_time": 1789529644,
      "event_id": "<deal.id>",
      "action_source": "business_messaging",
      "messaging_channel": "whatsapp",
      "user_data": {
        "whatsapp_business_account_id": "<meta_waba_id>",
        "ctwa_clid": "AfgDVt9Jf9YD66Cwn..."
      }
    }
  ],
  "access_token": "<decrypted meta_access_token>",
  "test_event_code": "<meta_test_event_code, only when set>"
}
```

Notes that matter:

- `event_time` is **seconds**, not milliseconds. The webhook's
  `messageTimestamp` is milliseconds (`1789529644000`) — divide, or the event is
  rejected as far-future.
- `whatsapp_business_account_id` is omitted when the account has none configured,
  rather than sent empty. Meta's business-messaging guide lists it as required;
  some setups are accepted with `ctwa_clid` alone. Omitting is the behaviour that
  fails loudly and diagnosably instead of silently mis-attributing — and the
  provisioning checklist (D6) makes filling it the default.
- No `custom_data`. Lead-type events do not require `currency`/`value`, and the
  deal's value is not a real transaction amount here.
- The token goes in the body, never in the URL, so it does not reach logs or
  proxy access logs.

### D5 — Error classification decides retry

| Meta response | Treated as |
|---|---|
| network error, timeout, 429, 5xx | retryable — backoff, `attempts + 1` |
| 400 with an invalid/expired `ctwa_clid` | permanent — `failed` |
| 400 with a malformed payload | permanent — `failed` (a bug, must be seen) |
| 401 / 403 / OAuth error subcodes | permanent — `failed`, token needs replacing |

Backoff: `next_attempt_at = now() + 5min * 2^attempts`, capped at 6 attempts
(~2.5h of retries), which sits comfortably inside the 7-day window.

Meta's own response body is stored verbatim in `last_error`. It is the only
useful diagnostic when attribution goes wrong, and paraphrasing it loses the
error subcode.

### D6 — Setup is a written checklist with a test mode, because code cannot verify the campaign

Nothing the CRM can do proves the ad set optimizes for the event we send. So the
provisioning screen carries the procedure, and test mode proves the half we *can*
verify:

1. In the clinic's Business Manager, confirm the WhatsApp number used by the ad
   is linked to the Page and that ad attribution is enabled for it — without it
   Meta does not attach `externalAdReply`, and no `ctwa_clid` ever arrives.
2. `POST /v23.0/<WABA_ID>/dataset` with a System User token → note the returned
   `dataset_id`. The call is idempotent; run it again to read the existing one.
3. Fill dataset ID, token, WABA ID on the account, plus a `test_event_code` taken
   from Events Manager → Test Events.
4. Qualify one real deal that came from an ad. Watch it appear in Test Events
   within minutes. This proves capture, identity, token and payload in one shot.
5. Clear the test code. Only then do events count for optimization.
6. In Ads Manager, the ad set's performance goal must be the conversion event
   this account reports (`meta_event_name`), on the dataset from step 2, with
   conversion location WhatsApp. Mismatch here is the one failure mode that
   produces zero errors on our side and zero optimization on theirs.

### D7 — Schema

```sql
-- contacts: attribution, last click wins
ALTER TABLE contacts
  ADD COLUMN ctwa_clid     TEXT,
  ADD COLUMN ad_source_id  TEXT,
  ADD COLUMN ctwa_clid_at  TIMESTAMPTZ;

-- accounts: 046 already added meta_dataset_id / meta_access_token
ALTER TABLE accounts
  ADD COLUMN meta_waba_id         TEXT,
  ADD COLUMN meta_event_name      TEXT NOT NULL DEFAULT 'Lead',
  ADD COLUMN meta_test_event_code TEXT;

CREATE TABLE meta_capi_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  event_name      TEXT NOT NULL,
  ctwa_clid       TEXT NOT NULL,
  ctwa_clid_at    TIMESTAMPTZ NOT NULL,
  event_time      TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sending','sent','failed','expired')),
  attempts        INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error      TEXT,
  response        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX meta_capi_events_deal_event_uniq
  ON meta_capi_events (deal_id, event_name);
CREATE INDEX meta_capi_events_due
  ON meta_capi_events (status, next_attempt_at) WHERE status = 'pending';
```

RLS: enabled, with no policy for client roles. Only the service role reads or
writes it — the rows contain the click ID, which is an advertising identifier.

## Risks / Trade-offs

- **The clinic's number may not expose a WABA ID.** UAZAPI connects by QR, and a
  number living only in the WhatsApp Business app may have no WABA asset in
  Business Manager. → D4 sends the event with `ctwa_clid` alone in that case, and
  step 4 of D6 (Test Events with a real deal) is what tells the operator whether
  that account is viable *before* the client is told the campaign is optimizing.
  If it is not, the number must move to Cloud API or Coexistence; that is a
  business decision, and this design makes it visible early instead of after a
  month of budget.
- **The 7-day window vs. a clinic's sales cycle.** A lead qualified on day nine
  is unreportable, full stop. → Counted as `expired`, shown on `/admin`. If the
  ratio is high, the fix is operational (qualify sooner, or qualify on first
  consultation booked rather than attended), not technical.
- **Event name mismatch with the ad set.** Silent on both sides. → D6 step 6 plus
  the on-screen note next to the field; `meta_event_name` is per account
  precisely so it can be matched to whatever the media buyer chose.
- **Expired access token.** Every event for that account fails with an OAuth
  subcode. → Permanent-failure classification plus the `/admin` counter; there is
  no dedicated screen, as decided in the plan.
- **Trigger-in-Postgres is invisible to TypeScript.** Nobody reading
  `deal-form.tsx` sees that saving fires a conversion. → A comment in the
  migration and in `src/lib/meta/capi.ts` pointing at each other, and a test that
  exercises the trigger through the database rather than mocking it.
- **`ON DELETE CASCADE` on `deal_id`.** Deleting a deal erases the evidence that
  its conversion was reported. Acceptable: the event is already at Meta, and
  keeping orphan rows would complicate the unique index for no operational gain.
