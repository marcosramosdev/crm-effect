## Why

Every lead this CRM handles arrives from a Click-to-WhatsApp (CTWA) ad, and the
whole point of the product is that the clinic's campaigns learn which creatives
bring people who actually become patients. Meta can only learn that if the
outcome travels back: an ad click carries a `ctwa_clid`, and the conversion that
happens days later inside a WhatsApp thread has to be reported against that same
click ID through the Conversions API. Today the gateway hands us the click ID on
the first inbound message — `message.content.contextInfo.externalAdReply.ctwaClid`
— and the webhook throws it away. The campaign optimizes on "who replies", not
"who becomes a qualified lead".

Sending the event is the easy half. The half that decides whether this works at
all is identity and timing, and it is what the planning document left vague:

- The destination is **not** a web Pixel. Business-messaging events go to a
  **dataset** that belongs to the clinic's WhatsApp Business Account, and the
  dataset ID cannot be derived from anything in the webhook payload — it is
  account-level configuration the Effect obtains once, in Events Manager or via
  `POST /<WABA_ID>/dataset`, and stores per account.
- Meta discards any event whose click is older than **7 days**, and any
  `event_time` in the future. A lead qualified on day nine is not a silent
  no-op we can ignore; it must be visibly recorded as such.
- The event name we send must be the same event the ad set optimizes for. A
  perfectly delivered `Lead` event is worthless if the ad set was built to
  optimize for conversations.
- Deal status is written from the browser today (`deal-form.tsx`,
  `contact-detail-view.tsx`, the pipeline board). There is no single server-side
  choke point where "became qualified" can be observed, so a send triggered from
  UI code would miss every other writer.

## What Changes

- **Inbound CTWA capture.** When an inbound message carries
  `contextInfo.externalAdReply`, the webhook persists `ctwa_clid`,
  `ad_source_id` and `ctwa_clid_at` on the contact. Last click wins: a later ad
  click overwrites an earlier one, so the conversion is attributed to the click
  that actually produced it. Organic conversations leave the columns null and
  are simply never reported.
- **Per-account Meta credentials**, filled by the Effect at provisioning and
  invisible to the client: `meta_dataset_id`, `meta_access_token` (encrypted
  with the existing GCM helper), `meta_waba_id`, `meta_event_name` (default
  `Lead`), and an optional `meta_test_event_code` used to validate the wiring in
  Events Manager before the account goes live. An account with no dataset ID
  simply does not report — this is a configuration state, not an error.
- **An outbox, not a direct call.** A database trigger on `deals` writes one
  `meta_capi_events` row when a deal transitions into `qualified`. Every writer
  — browser, API route, automation engine, future code — is covered by
  construction, and the HTTP call never runs inside a user's request.
- **A sender on the existing cron.** `/api/followups/cron` (change 4, already
  driven by `pg_cron` + `pg_net` with `x-cron-secret`) drains pending outbox
  rows: it POSTs to `graph.facebook.com/v23.0/<dataset_id>/events` with
  `action_source: "business_messaging"`, `messaging_channel: "whatsapp"`,
  `user_data.ctwa_clid`, `user_data.whatsapp_business_account_id` and
  `event_id = deal.id`, then records the outcome on the row. Failures retry with
  backoff up to a bounded attempt count; permanent rejections stop retrying.
- **Freshness is enforced before sending, not after.** A row whose
  `ctwa_clid_at` is more than 7 days old is marked `expired` without an HTTP
  call, carrying the reason. This makes the known limitation of CTWA attribution
  countable instead of invisible.
- **Operator surface in `/admin`.** Counts of pending, failed and expired
  events, the last send tick, and the per-account setup checklist (dataset,
  token, event name, matching ad-set optimization) so a broken account is
  discoverable without opening the database.

## Capabilities

### New Capabilities

- `meta-conversions`: capturing CTWA click attribution from inbound messages,
  enqueuing a conversion event when a deal becomes qualified, delivering it to
  the Meta Conversions API with deduplication and retry, and reporting the
  health of that delivery to operators.

### Modified Capabilities

- `whatsapp-messaging`: inbound message handling gains a requirement to persist
  the CTWA tracking fields carried by `contextInfo.externalAdReply`.
- `provisioning`: the provisioning form gains the Meta credential fields and the
  requirement that they are stored encrypted and never exposed to the client.

## Impact

- **Database**: `supabase/migrations/048_meta_capi.sql` — CTWA columns on
  `contacts`, Meta credential columns on `accounts`, the `meta_capi_events`
  table, the `deals` status trigger, and RLS keeping the table
  service-role-only.
- **Code**: `src/app/api/whatsapp/webhook/[secret]/route.ts` (capture),
  `src/lib/meta/capi.ts` (payload build + send, new), `src/lib/meta/outbox.ts`
  (drain + retry, new), `src/app/api/followups/cron/route.ts` (third pass),
  `src/lib/provisioning/*` and `src/app/admin/*` (credentials + counters).
- **External**: outbound HTTPS to `graph.facebook.com`. Requires a Meta access
  token with `whatsapp_business_management` and `whatsapp_business_manage_events`
  on an app with Marketing API advanced access.
- **Operational**: the clinic's ad set must optimize for the same event name the
  CRM sends. That is campaign configuration outside this codebase, and this
  change documents it as a provisioning step rather than pretending code can
  enforce it.
