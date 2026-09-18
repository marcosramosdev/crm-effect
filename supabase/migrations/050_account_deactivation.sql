-- ============================================================
-- 050_account_deactivation.sql — taking an account out of service
--
-- An operator deactivates an account when a clinic stops being a
-- client (see openspec/changes/admin-client-lifecycle/{proposal,
-- design}.md). Deactivation destroys nothing and is reversible, so
-- one nullable timestamp carries the whole state: NULL = active.
--
-- Enforcement lives in getCurrentAccount() (design.md D2), which
-- already reads this row for every authenticated request — hence the
-- column-level grant below, widened from migration 046. A client
-- learning that their own account is deactivated is exactly what the
-- product shows them.
--
-- Applied by hand in the Supabase SQL editor, like every migration in
-- this project. Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

COMMENT ON COLUMN accounts.deactivated_at IS
  'When a platform operator took this account out of service. NULL = active, the default for every account. No member of a deactivated account can sign in or hold a working session (admin-console spec.md), its waiting meta_capi_events are canceled at deactivation, and any future conversion sender MUST filter deactivated_at IS NULL. Inbound WhatsApp traffic is still received and stored, which is what makes reactivation lossless.';

-- Column-level grant, re-stating migration 046's list plus the new
-- column. GRANT is additive, so the existing privileges survive; the
-- token and dataset columns stay unreadable to the authenticated role.
GRANT SELECT (id, name, owner_user_id, default_currency, timezone, created_at, updated_at, deactivated_at)
  ON accounts TO authenticated;

-- Partial index: the console reads the active roster on every load and
-- deactivated accounts are the rare case.
CREATE INDEX IF NOT EXISTS idx_accounts_deactivated
  ON accounts(deactivated_at) WHERE deactivated_at IS NOT NULL;
