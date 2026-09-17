-- ============================================================
-- 048_meta_capi.sql — Meta Conversions API, capture and enqueue
--
-- See openspec/changes/meta-capi-qualified-lead/design.md (D11 for
-- this schema verbatim, D2 for the enqueue outcomes, D9 for why the
-- four trigger details below are load-bearing).
--
-- What this migration adds
--   1. `contacts` — CTWA click attribution (last click wins).
--   2. `accounts` — four more advertising columns. Deliberately NOT
--      added to migration 046's narrowed SELECT grant — see the
--      comment at that GRANT below.
--   3. `meta_capi_events` — the outbox. RLS enabled with zero
--      policies (service-role-only; see the comment at ENABLE ROW
--      LEVEL SECURITY).
--   4. Two triggers on `deals` (`_ins` / `_upd` — two triggers can't
--      share one name on one table) that enqueue a row when a deal
--      becomes `qualified`. SECURITY DEFINER: the trigger runs as
--      whichever role wrote the row, which is `authenticated` for
--      every browser writer, and migration 046 revoked
--      `SELECT ON accounts` from that role. Without SECURITY DEFINER,
--      every drag of a card to Qualified fails in the browser.
--
-- Idempotent — safe to re-run: every object uses IF NOT EXISTS,
-- ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, or DROP … CREATE.
-- Applied by hand in the Supabase SQL editor, like every migration in
-- this project.
-- ============================================================

-- ============================================================
-- 1. contacts — ad attribution, last click wins
-- ============================================================
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS ctwa_clid     TEXT,
  ADD COLUMN IF NOT EXISTS ad_source_id  TEXT,
  ADD COLUMN IF NOT EXISTS ctwa_clid_at  TIMESTAMPTZ;

COMMENT ON COLUMN contacts.ctwa_clid IS
  'Click-to-WhatsApp click id from message.content.contextInfo.externalAdReply.ctwaClid on the first message of an ad-started conversation. Last click wins — a later ad click overwrites this. NULL means organic.';
COMMENT ON COLUMN contacts.ad_source_id IS
  'The creative id (externalAdReply.sourceID). Diagnostics only — never sent to Meta.';
COMMENT ON COLUMN contacts.ctwa_clid_at IS
  'When ctwa_clid was captured. Snapshotted onto meta_capi_events at qualification time — this column keeps moving as new clicks arrive, that row does not.';

-- ============================================================
-- 2. accounts — advertising configuration
-- meta_dataset_id and meta_access_token already exist (migration 046).
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS meta_page_id         TEXT,
  ADD COLUMN IF NOT EXISTS meta_event_name      TEXT NOT NULL DEFAULT 'Lead',
  ADD COLUMN IF NOT EXISTS meta_test_event_code TEXT,
  ADD COLUMN IF NOT EXISTS meta_send_ph         BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN accounts.meta_page_id IS
  'The Facebook Page the account''s CTWA ads run from. Operator diagnostics only (design.md D4) — never sent to Meta. This is a WhatsApp business-messaging event; Page-based identity is the Messenger path.';
COMMENT ON COLUMN accounts.meta_event_name IS
  'Conversion event name reported to Meta, e.g. "Lead". Must match what the account''s ad set optimizes for (design.md D8) — nothing in this system can verify that match.';
COMMENT ON COLUMN accounts.meta_test_event_code IS
  'Set while validating in Events Manager → Test Events. An account left in test mode reports nothing for optimization while looking fully configured (design.md D8).';
COMMENT ON COLUMN accounts.meta_send_ph IS
  'Whether delivery includes user_data.ph (hashed phone). Defaults false: sending a hash of a patient''s phone to an ad platform needs its own LGPD basis, separate from holding the number to run the conversation (design.md D9). An operator turns this on only once that basis exists.';

-- Deliberately NOT added to migration 046's narrowed SELECT grant.
-- Migration 047 added new accounts columns TO that grant because
-- those columns are client-readable; these four are not — they are
-- the Effect's own advertising configuration, invisible to the
-- client exactly like meta_dataset_id and meta_access_token already
-- are. The omission is the requirement (provisioning spec.md,
-- "Advertising credentials are invisible to the client"), not an
-- oversight.

-- ============================================================
-- 3. meta_capi_events — the outbox
-- ============================================================
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

COMMENT ON TABLE meta_capi_events IS
  'One row per (deal, event_name) — enqueued by the deals trigger below when a deal becomes qualified, never written directly by application code. While this change is capture-only, only pending and unconfigured occur; the other four states are reserved for the delivery pass (design.md D0/D11).';
COMMENT ON COLUMN meta_capi_events.status IS
  'unconfigured rows are historical and never revive (design.md D3): configuring the account later does not move them to pending. The claim query for delivery must not select unconfigured.';

-- RLS enabled with ZERO policies. Supabase grants new public tables
-- to `authenticated` by default, so RLS-with-no-policy — not a
-- policy — is what makes this table service-role-only. A policy
-- here, even a read-only one scoped by account, would leak
-- ctwa_clid, which Meta treats as personal data (provisioning
-- spec.md, "Recorded conversions are never readable by clinic
-- users").
ALTER TABLE meta_capi_events ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. Enqueue trigger (design.md D1/D2/D11)
-- ============================================================
CREATE OR REPLACE FUNCTION meta_capi_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctwa_clid    TEXT;
  v_ctwa_clid_at TIMESTAMPTZ;
  v_dataset_id   TEXT;
  v_event_name   TEXT;
  v_status       TEXT;
BEGIN
  -- Guard the unchanged status: AFTER UPDATE OF status fires whenever
  -- the column appears in the SET list, changed or not (the pipeline
  -- board writes whole rows). Only act on an actual transition into
  -- qualified.
  IF TG_OP = 'UPDATE' AND (OLD.status = NEW.status OR NEW.status <> 'qualified') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.status <> 'qualified' THEN
    RETURN NEW;
  END IF;

  SELECT c.ctwa_clid, c.ctwa_clid_at
    INTO v_ctwa_clid, v_ctwa_clid_at
    FROM contacts c
    WHERE c.id = NEW.contact_id;

  -- Organic: no click, nothing to enqueue (design.md D2).
  IF v_ctwa_clid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.meta_dataset_id, a.meta_event_name
    INTO v_dataset_id, v_event_name
    FROM accounts a
    WHERE a.id = NEW.account_id;

  v_status := CASE WHEN v_dataset_id IS NULL THEN 'unconfigured' ELSE 'pending' END;

  BEGIN
    INSERT INTO meta_capi_events (
      account_id, deal_id, contact_id,
      event_name, event_time,
      ctwa_clid, ctwa_clid_at, status
    ) VALUES (
      NEW.account_id, NEW.id, NEW.contact_id,
      v_event_name, now(),
      v_ctwa_clid, v_ctwa_clid_at, v_status
    )
    ON CONFLICT (deal_id, event_name) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- An outbox bug must never cost the clinic a status change
    -- (design.md D11). Log and let the deal write through.
    RAISE WARNING 'meta_capi_enqueue: failed to enqueue for deal %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION meta_capi_enqueue() IS
  'SECURITY DEFINER: runs as authenticated for every browser writer, and migration 046 revoked SELECT ON accounts from that role — without this, qualifying a deal fails in the browser. Never raises past its own INSERT; a failure here must not abort the caller''s deal write.';

DROP TRIGGER IF EXISTS meta_capi_enqueue_upd ON deals;
CREATE TRIGGER meta_capi_enqueue_upd
  AFTER UPDATE OF status ON deals
  FOR EACH ROW EXECUTE FUNCTION meta_capi_enqueue();

-- AFTER INSERT, never BEFORE INSERT: meta_capi_events.deal_id
-- references deals(id); in a BEFORE INSERT trigger that row does not
-- exist yet, the foreign key check fails, and the deal insert itself
-- aborts. AFTER INSERT has identical semantics here — NEW.id is
-- already populated by the column default.
DROP TRIGGER IF EXISTS meta_capi_enqueue_ins ON deals;
CREATE TRIGGER meta_capi_enqueue_ins
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION meta_capi_enqueue();
