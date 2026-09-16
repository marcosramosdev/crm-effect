## Why

The CRM is sold bundled with Effect Digital's other services, never as a
self-service product. Effect sells the account, sets it up, and hands the
client a working login. Today the product contradicts that: anyone can open
`/signup`, create an empty account, and land on a blank pipeline with no
WhatsApp instance, no AI persona, and no ad-tracking credentials — all of
which only Effect can supply. Every sale currently ends in a manual setup
session across the Supabase dashboard, the UAZAPI panel, and the app itself.

## What Changes

- **BREAKING**: public self-service signup is closed. `/signup` without a
  valid invite token redirects to `/login`. The teammate-invite flow
  (`/join/<token>` → `/signup?invite=…`) keeps working unchanged, so an
  account owner can still add colleagues.
- New internal route `/admin`, gated by `PLATFORM_ADMINS` — a comma-separated
  allow-list of Effect operator e-mail addresses read from the server
  environment. Not an account role; membership in the list is the only
  credential. Non-listed users get the same treatment as an unknown route.
- A provisioning form at `/admin` that stands up a whole client account in one
  submission: an already-confirmed Supabase Auth user with an
  Effect-chosen password, the account record with its name and timezone, the
  owner profile, a pipeline seeded from the chosen specialty template, a
  UAZAPI gateway instance ready for the client to scan, an `ai_configs` row
  carrying the clinic persona and default follow-up style, and the account's
  encrypted Meta Conversions credentials.
- Specialty pipeline templates defined in code — dentist, physician,
  psychologist. Every template's first stage is **"Em contato"**.
- `pipeline_stages.is_system BOOLEAN`: a system stage cannot be renamed,
  deleted, or moved out of first position. Enforced by database triggers, not
  only by the UI, so RLS-authenticated clients and the public API are covered
  too.
- `whatsapp_config.inbound_default_pipeline_id` / `inbound_default_stage_id`
  are pointed at the seeded pipeline and its system stage at provisioning
  time, so every new inbound WhatsApp lead lands in "Em contato" without the
  client configuring anything.
- Meta Conversions credentials on `accounts`: `meta_dataset_id` plus
  `meta_access_token` encrypted with the existing AES-256-GCM key. Written
  only by provisioning, never readable by the client's own session.
- A dismissible banner on first login suggesting the client change the
  delivered password. Suggestion only — the password is never force-expired.

## Capabilities

### New Capabilities
- `provisioning`: how an Effect operator creates a complete, ready-to-use
  client account from one internal form — who may reach the form, what a
  successful provision produces, what happens when a step fails partway, and
  how the delivered credentials reach the client.

### Modified Capabilities
- `deals`: adds the system-stage requirement — a pipeline may carry a stage
  that is protected from rename, deletion, and reordering.
- `whatsapp-connection`: instance provisioning may now happen ahead of the
  client's first visit to the connection screen, so the client's first action
  is scanning a QR code rather than pressing "connect".

## Impact

- **Schema** (`supabase/migrations/046_provisioning.sql`, applied by hand in
  the Supabase SQL editor): `pipeline_stages.is_system`, two `accounts`
  columns for the Meta credentials, and the triggers that protect a system
  stage.
- **New code**: `src/app/admin/*` (page, form, server action),
  `src/lib/provisioning/*` (templates, the provisioning orchestrator, the
  `PLATFORM_ADMINS` guard).
- **Touched code**: `src/middleware.ts` (invite-only `/signup`, `/admin`
  guard), `src/app/(auth)/signup/page.tsx` and `src/app/(auth)/login/page.tsx`
  (invite-token gating and link removal), `src/components/pipelines/pipeline-settings.tsx`
  (system stage is not editable), the dashboard shell (first-login banner),
  `messages/{pt-BR,en}.json`.
- **Reused, not rebuilt**: `provisionInstance()` in
  `src/lib/whatsapp/instance.ts` already creates a UAZAPI instance with
  `UAZAPI_ADMIN_TOKEN`; `encrypt()` in `src/lib/whatsapp/encryption.ts`
  already wraps AES-256-GCM; the `handle_new_user` trigger from migration 017
  already creates the account and owner profile on auth-user insert.
- **New environment variable**: `PLATFORM_ADMINS`. `SUPABASE_SERVICE_ROLE_KEY`,
  `UAZAPI_ADMIN_TOKEN`, and `ENCRYPTION_KEY` are already required and are
  reused as-is.
- **Depends on**: change 1 (`lead-scheduling-and-calendar`) for
  `accounts.timezone`, change 2 (`centralized-ai-setup`) for an `ai_configs`
  row that is valid without an API key. **Feeds**: change 5
  (`meta-capi-qualified-lead`) reads the Meta credentials written here.
