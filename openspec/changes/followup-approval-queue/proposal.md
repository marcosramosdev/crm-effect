## Why

A clinic's two highest-value follow-ups — reminding a booked lead that the
appointment is coming, and reaching back out to a lead who went quiet — are
today entirely manual. Nobody watches `deals.scheduled_at`, so reminders go out
when someone remembers, and a lead whose last message was three weeks ago is
indistinguishable from one who wrote yesterday.

The obvious fix is to let the system send them. That is exactly what must not
happen. This is healthcare: a wrong name, a wrong time, or a message to a lead
who already cancelled is a real-world harm, and Brazilian medical advertising
rules (CFM 1.974/2011) apply to every word that leaves the number. So the
system prepares the work and a human releases it — never the reverse.

## What Changes

- New table `followup_messages`: one row per (deal, reminder offset), carrying
  the rendered body, a status of `pending`, `approved`, `sent`, `rejected` or
  `expired`, and the timestamps of each transition. A pending row is a piece of
  prepared work, not a scheduled send.
- Per-account follow-up configuration on `accounts`: up to three reminder
  offsets before the appointment (default 5 days, 1 day, 2 hours), the reminder
  template with the placeholders `{nome}`, `{data}`, `{hora}` and `{medico}`,
  and the number of days of silence after which a lead counts as stale
  (default 15). Admin-editable, in the existing settings screen.
- A scheduled job runs `/api/followups/cron` on a fixed interval, authenticated
  with the `x-cron-secret` header the other two crons already use. The job does
  two things and nothing else: it **materialises** the pending rows that are now
  due, and it **expires** the pending rows whose appointment has passed. It
  never sends a message and never calls the WhatsApp gateway.
- A "Pending approval" section on `/notifications` listing the account's pending
  follow-ups with the lead, the appointment time, the rendered body, and three
  actions: **Approve**, **Reject**, and **Edit and send**. Visible to, and
  actionable by, any member with agent permission or above.
- An approved reminder goes out as an interactive message with two buttons —
  **Confirmar** and **Remarcar** — through the existing
  `sendMessageToConversation()` path, so it lands in the inbox thread like any
  other outbound message.
- The lead's button press arrives on the WhatsApp webhook as an
  `interactive_reply_id`. **Confirmar** stamps `deals.appointment_confirmed_at`
  and flags the same deal's remaining pending rows as already-confirmed —
  flags, does not cancel, so a human still decides whether to send them.
  **Remarcar** raises an inbox notification and changes no scheduling data:
  `scheduled_at` is only ever moved by a person.
- An "AI follow-up" action on any lead: it drafts a message from that
  conversation's history in the account's configured communication style, and
  opens it for review. The draft is never sent by the action that produced it.
- A reactivation tab inside `/pipelines` listing leads filtered by days without
  contact (from `conversations.last_message_at`), pipeline stage, and whether a
  future appointment exists, with a count badge.

## Capabilities

### New Capabilities
- `followups`: how a follow-up message is prepared, reviewed by a human,
  released or refused, and what happens when the lead answers it. Covers the
  reminder queue and its lifecycle, the per-account follow-up configuration,
  the AI-drafted follow-up for a quiet lead, and the reactivation list.

### Modified Capabilities
- `inbox`: an inbound interactive reply is currently routed only to flows and
  automations. It gains a defined meaning when it answers a follow-up reminder —
  confirming or asking to reschedule an appointment — and that routing must
  not swallow the message for the rest of the inbox.

## Impact

- **Schema** (`supabase/migrations/047_followup_queue.sql`, applied by hand in
  the Supabase SQL editor): the `followup_messages` table with its RLS policies
  and its `(deal_id, offset_minutes)` uniqueness, three follow-up settings
  columns on `accounts` plus the matching column-level `GRANT SELECT`, and the
  `pg_cron` schedule that drives the endpoint through `pg_net`.
- **New code**: `src/app/api/followups/cron/route.ts`, `src/lib/followups/*`
  (materialisation, template rendering, state transitions, the stale-lead
  query), the pending-approval section under `src/components/notifications/`,
  and the reactivation tab under `src/components/pipelines/`.
- **Touched code**: `src/app/(dashboard)/notifications/page.tsx`,
  `src/app/(dashboard)/pipelines/page.tsx`,
  `src/app/api/whatsapp/webhook/[secret]/route.ts` (button-reply routing),
  `src/app/api/ai/draft/route.ts` and `src/lib/ai/generate.ts` (a follow-up
  draft mode alongside the existing reply draft), the `deals` settings section
  in `src/components/settings/`, and `messages/{pt-BR,en}.json`.
- **Reused, not rebuilt**: `sendMessageToConversation()` in
  `src/lib/whatsapp/send-message.ts` already sends an interactive-buttons
  payload, writes the `messages` row and bumps the conversation;
  `parseMessageContent()` in the webhook already extracts
  `interactiveReplyId`; the constant-time secret check in
  `src/app/api/flows/cron/route.ts` is the pattern for the new cron;
  `buildConversationContext()`, `buildSystemPrompt()` and `generateReply()`
  already produce a styled, guardrailed draft.
- **New environment / operator setup**: no new application env var —
  `AUTOMATION_CRON_SECRET` is reused. The `pg_cron` job needs the deployment's
  base URL and that same secret available inside Postgres; both are read from
  Supabase Vault so neither is committed to the repository.
- **Depends on**: change 1 (`lead-scheduling-and-calendar`) for
  `deals.scheduled_at`, `deals.appointment_confirmed_at` and
  `accounts.timezone`; change 2 (`centralized-ai-setup`) for
  `ai_configs.followup_style` and the deployment-held provider key.
  **Feeds**: change 5 (`meta-capi-qualified-lead`) reuses the cron endpoint
  shape established here.
