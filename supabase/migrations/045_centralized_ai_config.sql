-- ============================================================
-- 045_centralized_ai_config.sql — centralized AI credentials
--
-- The AI provider, model and key move to the deployment environment
-- (AI_PROVIDER / AI_MODEL / AI_API_KEY); the per-account columns
-- become a fallback for a deployment that sets none of them. A row
-- can now exist with no key at all — the provisioning flow writes
-- exactly that shape — so `api_key`, `provider` and `model` drop
-- their NOT NULL constraint.
--
-- `is_active` changes meaning: it no longer gates auto-reply (that is
-- `auto_reply_enabled` alone), it now means "the assistant suggests
-- drafts", defaulting to on. Every existing row is backfilled to
-- true: in practice an `is_active = false` row today marks a BYO-key
-- setup that was never finished, and drafts are a review-before-send
-- surface — nothing reaches a patient without a human pressing send.
-- `auto_reply_enabled` is untouched by this backfill.
--
-- `followup_style` is the account's default tone for generated
-- messages — friendly / direct / consultative / slot_reminder.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs ALTER COLUMN api_key DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE ai_configs ALTER COLUMN model DROP NOT NULL;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS followup_style text NOT NULL DEFAULT 'friendly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_configs_followup_style_check'
  ) THEN
    ALTER TABLE ai_configs
      ADD CONSTRAINT ai_configs_followup_style_check
      CHECK (followup_style IN ('friendly', 'direct', 'consultative', 'slot_reminder'));
  END IF;
END $$;

ALTER TABLE ai_configs ALTER COLUMN is_active SET DEFAULT true;

UPDATE ai_configs SET is_active = true WHERE is_active = false;
