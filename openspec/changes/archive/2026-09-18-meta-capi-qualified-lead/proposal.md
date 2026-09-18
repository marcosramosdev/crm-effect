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
all is identity and timing:

- **The clinics here have no WhatsApp Business Account.** Their numbers run on
  an unofficial gateway (UAZAPI), not on Meta's WhatsApp Business Platform, and
  that is a deliberate, standing decision. Meta's documented business-messaging
  path — `POST /<WABA_ID>/dataset`, then `user_data.whatsapp_business_account_id`
  — therefore has no input to work from. The destination instead is a dataset
  created in the **Effect's own Events Manager** and shared with the client's ad
  account, with its access token generated there too — which needs no Meta app,
  no System User and no App Review. Whether Meta accepts a WhatsApp
  business-messaging event carrying `ctwa_clid` alone, posted to a dataset with
  no WABA behind it, is not documented either way, and is settled by one
  experiment rather than by reading.
- Meta discards any event whose click is older than **7 days**. For a clinic
  whose sales cycle is "lead today, consultation next week", that is a routine
  outcome, not an edge case.
- The event name sent must be the same event the ad set optimizes for. A
  perfectly delivered `Lead` event is worthless if the ad set was built to
  optimize for conversations.
- Deal status is written from the browser today (`deal-form.tsx`,
  `contact-detail-view.tsx`, the pipeline board). There is no single server-side
  choke point where "became qualified" can be observed, so a send triggered from
  UI code would miss every other writer.

Capture does not depend on any of this. A click identifier stored today is
stored regardless of where it eventually goes, and a click not stored today is
gone. This change therefore lands capture first and treats delivery as
conditional on the experiment — see `design.md`, D0.

## What Changes

- **Inbound CTWA capture.** When an inbound message carries
  `contextInfo.externalAdReply`, the webhook persists `ctwa_clid`,
  `ad_source_id` and `ctwa_clid_at` on the contact. Last click wins: a later ad
  click overwrites an earlier one, so the conversion is attributed to the click
  that actually produced it. Organic conversations leave the columns null.
- **An outbox, not a direct call.** A database trigger on `deals` writes one
  `meta_capi_events` row when a deal transitions into `qualified`. Every writer
  — browser, API route, automation engine, future code — is covered by
  construction, and no HTTP call ever runs inside a user's request.
- **Unreported conversions are counted, not swallowed.** A qualification with a
  click but no configured dataset is written as `unconfigured` rather than
  dropped. That count — "N qualified leads Meta never heard about" — is the
  number that justifies configuring the account, and it is the only observable
  output of this change while delivery is unresolved.
- **Per-account advertising configuration**, filled by the Effect and invisible
  to the client: the existing `meta_dataset_id` and `meta_access_token`, plus
  `meta_page_id`, `meta_event_name` (default `Lead`), `meta_test_event_code`,
  and `meta_send_ph`. An account with no dataset ID does not report; that is a
  configuration state, not an error.
- **An operator edit path.** `/admin` gains a per-account form for the
  advertising configuration, gated by the existing `PLATFORM_ADMINS` allow-list
  (`src/lib/provisioning/platform-admins.ts`), so credentials can be filled or
  corrected without re-provisioning. The client-facing grant narrowed in
  migration 046 is left untouched.
- **Delivery is specified after the experiment.** The sender, its retry policy,
  the 7-day freshness check and the delivery counters are added to this change
  once the experiment in D0 returns. If Meta rejects an event carrying
  `ctwa_clid` alone, this change ships as capture only and records the rejection
  as the reason.

## Capabilities

### New Capabilities

- `meta-conversions`: capturing CTWA click attribution from inbound messages,
  enqueuing a conversion event when a deal becomes qualified, and reporting to
  operators how many conversions are waiting or unreportable.

### Modified Capabilities

- `whatsapp-messaging`: inbound message handling gains a requirement to persist
  the CTWA tracking fields carried by `contextInfo.externalAdReply`.
- `provisioning`: the advertising configuration is extended and gains an
  operator edit path after provisioning.

## Impact

- **Database**: `supabase/migrations/048_meta_capi.sql` — CTWA columns on
  `contacts`, advertising configuration columns on `accounts`, the
  `meta_capi_events` table, the `deals` status triggers, and RLS keeping the
  table service-role-only.
- **Code**: `src/app/api/whatsapp/webhook/[secret]/route.ts` (capture),
  `src/app/api/admin/accounts/[id]/meta/route.ts` (edit path, new),
  `src/app/admin/*` and `src/components/admin/*` (form + counters),
  `src/lib/provisioning/*`.
- **External**: none while this change is capture-only. Delivery adds outbound
  HTTPS to `graph.facebook.com`.
- **Legal**: `meta_send_ph` ships defaulting to `false` and stays off until the
  clinic has consent covering the sharing of a patient's phone number with an ad
  platform. See `design.md`, D9.
- **Operational**: the clinic's ad set must optimize for the same event name the
  CRM sends. That is campaign configuration outside this codebase, documented as
  a provisioning step rather than pretended to be enforceable in code.
