-- ============================================================
-- 047_followup_queue.sql — appointment-reminder approval queue
--
-- See openspec/changes/followup-approval-queue/design.md.
--
-- What this migration adds
--   1. `followup_messages` — one row per (deal, reminder offset).
--      States as data (D1): pending / approved / sent / rejected /
--      expired. No `send_at` column exists anywhere — nothing here
--      carries an instruction to send; only a human release does.
--   2. Three follow-up settings columns on `accounts` (D4), plus the
--      matching column-level GRANT (migration 046 narrowed the
--      table's SELECT grant to a named list — new client-readable
--      columns must be added there too or they're invisible to
--      `authenticated`).
--   3. `followup_reschedule` added to `notifications.type`'s CHECK
--      (D10).
--   4. `run_followups_tick()` (D3) — a SECURITY DEFINER function
--      that reads the cron URL/secret from Supabase Vault and calls
--      `net.http_get`, wired to `pg_cron` when available.
--   5. `followup_cron_state` — a one-row table holding the
--      timestamp of the last successful
--      `GET /api/followups/cron` call, so the pending-approval queue
--      can show it (design.md Risks: "the cron stops and nobody
--      notices").
--
-- Idempotent — safe to re-run: every object uses IF NOT EXISTS or
-- DROP … CREATE, and the pg_cron block is skipped when pg_cron/pg_net
-- aren't installed.
-- ============================================================

-- ============================================================
-- 1. followup_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS followup_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id             UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES conversations(id) ON DELETE CASCADE,
  offset_minutes      INTEGER NOT NULL,
  body                TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'sent', 'rejected', 'expired')),
  -- Flag written by the webhook's confirm branch (D8) — NOT a status.
  -- A confirmed appointment's remaining reminders stay pending; a
  -- human still decides whether to send them.
  appointment_confirmed BOOLEAN NOT NULL DEFAULT false,
  decided_by          UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at          TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  whatsapp_message_id TEXT,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Preparation's dedupe rule as a constraint, not a query the cron
  -- has to get right (D1). ON CONFLICT DO NOTHING on insert.
  UNIQUE (deal_id, offset_minutes)
);

-- Pending-queue read: "this account's pending follow-ups".
CREATE INDEX IF NOT EXISTS idx_followup_messages_account_status
  ON followup_messages (account_id, status);

-- The confirm flow's "this deal's remaining pending rows" lookup is
-- already served by the UNIQUE (deal_id, offset_minutes) constraint
-- above — deal_id is that index's leading column, so a deal_id-only
-- filter is an index scan with no separate index needed.

ALTER TABLE followup_messages ENABLE ROW LEVEL SECURITY;

-- Read-only members see the queue (spec: "Read-only member"); only
-- agent+ can decide (approve/reject/edit_and_send). No client
-- INSERT/DELETE policy — rows are written by the service role (the
-- cron's materialise/expire passes), which bypasses RLS entirely.
DROP POLICY IF EXISTS followup_messages_select ON followup_messages;
CREATE POLICY followup_messages_select ON followup_messages
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS followup_messages_update ON followup_messages;
CREATE POLICY followup_messages_update ON followup_messages
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON followup_messages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON followup_messages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE followup_messages IS
  'One row per (deal, reminder offset). A pending row is prepared work '
  'awaiting a human decision, never a scheduled send — there is no '
  '"send at" column anywhere on this table.';

-- ============================================================
-- 2. accounts — follow-up configuration (D4)
-- ============================================================

-- Validates a `followup_offsets` array without a correlated subquery
-- in the CHECK itself (Postgres disallows subqueries directly inside
-- a CHECK expression) — the unnest/aggregate work happens inside this
-- IMMUTABLE function instead, which only ever reads its own argument.
CREATE OR REPLACE FUNCTION valid_followup_offsets(offsets INTEGER[])
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT cardinality(offsets) <= 3
    AND NOT EXISTS (SELECT 1 FROM unnest(offsets) x WHERE x <= 0)
    AND cardinality(offsets) = (SELECT count(DISTINCT x) FROM unnest(offsets) x);
$$;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS followup_offsets INTEGER[] NOT NULL DEFAULT '{7200,1440,120}';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS followup_reminder_template TEXT NOT NULL DEFAULT
    'Olá {nome}! Passando para lembrar do seu horário em {data} às {hora} com {medico}. Você confirma?';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS stale_lead_days INTEGER NOT NULL DEFAULT 15;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_followup_offsets_valid;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_followup_offsets_valid
    CHECK (valid_followup_offsets(followup_offsets));

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_stale_lead_days_positive;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_stale_lead_days_positive
    CHECK (stale_lead_days > 0);

COMMENT ON COLUMN accounts.followup_offsets IS
  'Minutes before deals.scheduled_at that a reminder is prepared, most-'
  'distant first by convention. At most 3, each positive, no duplicates '
  '(accounts_followup_offsets_valid). Default 5 days / 1 day / 2 hours.';

COMMENT ON COLUMN accounts.followup_reminder_template IS
  'Reminder body template. Legal placeholders: {nome} {data} {hora} '
  '{medico} — see src/lib/followups/template.ts, the single source of '
  'truth for the set, shared by the settings form and the renderer.';

COMMENT ON COLUMN accounts.stale_lead_days IS
  'Days of silence after which a lead is treated as stale on the '
  'reactivation list. Positive integer, default 15.';

-- Migration 046 narrowed accounts' SELECT grant to a named column
-- list — extend it, or these three columns are invisible to
-- `authenticated` despite accounts_select already covering every
-- member.
GRANT SELECT (followup_offsets, followup_reminder_template, stale_lead_days)
  ON accounts TO authenticated;

-- ============================================================
-- 3. notifications.type — add followup_reschedule (D10)
-- ============================================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('conversation_assigned', 'followup_reschedule'));

-- ============================================================
-- 4. pg_cron tick (D3) — Vault-held URL/secret, pg_net dispatch
-- ============================================================
CREATE OR REPLACE FUNCTION run_followups_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT;
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'followup_cron_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets WHERE name = 'followup_cron_secret';

  IF v_url IS NULL OR v_secret IS NULL THEN
    RAISE NOTICE 'run_followups_tick: followup_cron_url / followup_cron_secret not set in Vault — skipping, no request made.';
    RETURN;
  END IF;

  PERFORM net.http_get(
    url := v_url,
    headers := jsonb_build_object('x-cron-secret', v_secret)
  );
END;
$$;

COMMENT ON FUNCTION run_followups_tick() IS
  'Fires GET /api/followups/cron via pg_net, using the URL/secret held '
  'in Supabase Vault. Does nothing (and makes no request) until both '
  'vault secrets exist — see the Migration Plan in design.md.';

-- Guarded: a deployment without pg_cron/pg_net still applies this
-- migration cleanly, and drives the same endpoint from an external
-- pinger instead (the documented fallback — see design.md D3).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'followups-tick') THEN
      PERFORM cron.unschedule('followups-tick');
    END IF;
    PERFORM cron.schedule('followups-tick', '*/15 * * * *', 'SELECT run_followups_tick();');
  ELSE
    RAISE NOTICE 'pg_cron/pg_net not installed — skipping the followups-tick schedule; drive GET /api/followups/cron from an external pinger instead.';
  END IF;
END $$;

-- ============================================================
-- 5. followup_cron_state — last successful tick (singleton row)
--
-- `id BOOLEAN ... CHECK (id)` is the standard one-row-table trick:
-- the only legal value is `true`, and it's the primary key, so a
-- second INSERT can never succeed. Global, not per-account — the
-- cron processes every account in one pass, so there is exactly one
-- "last successful tick" for the whole deployment.
-- ============================================================
CREATE TABLE IF NOT EXISTS followup_cron_state (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  last_tick_at TIMESTAMPTZ
);

INSERT INTO followup_cron_state (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE followup_cron_state ENABLE ROW LEVEL SECURITY;

-- Any signed-in member reads it (the queue page shows it); only the
-- service role (the cron route) ever writes it.
DROP POLICY IF EXISTS followup_cron_state_select ON followup_cron_state;
CREATE POLICY followup_cron_state_select ON followup_cron_state
  FOR SELECT USING (auth.uid() IS NOT NULL);
