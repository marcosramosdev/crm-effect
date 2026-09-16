-- ============================================================
-- 046_provisioning.sql — client provisioning
--
-- Effect Digital operators provision every client account by hand
-- from a new internal console (see
-- openspec/changes/client-provisioning/{proposal,design}.md). This
-- migration adds the schema that console depends on:
--
--   1. `pipeline_stages.is_system` — a stage that can't be renamed,
--      deleted, or moved out of position 0. Enforced by triggers so
--      the refusal holds for every write path, not just the UI.
--   2. `accounts.meta_dataset_id` / `meta_access_token` — the
--      account's Meta Conversions credentials, hidden from the
--      `authenticated` role by a column-level grant swap (RLS is
--      row-level and can't hide a column).
--   3. `profiles.password_banner_dismissed_at` — drives the "change
--      your delivered password" banner.
--
-- Applied by hand in the Supabase SQL editor, like every migration in
-- this project. Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. pipeline_stages.is_system
-- ============================================================
ALTER TABLE pipeline_stages
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_one_system
  ON pipeline_stages(pipeline_id) WHERE is_system;

-- ------------------------------------------------------------
-- Backfill — runs BEFORE the triggers below exist, so it can't be
-- blocked by them. Every existing account is an Effect test account;
-- no client data is at risk. Marks the position-0 stage of each
-- account's first (earliest-created) pipeline as the system stage.
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (p.account_id) p.id AS pipeline_id
    FROM pipelines p
    ORDER BY p.account_id, p.created_at ASC, p.id ASC
  LOOP
    UPDATE pipeline_stages
    SET is_system = true,
        name = 'Em contato'
    WHERE pipeline_id = r.pipeline_id
      AND position = 0;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- Triggers — the contract lives here, not in the UI. See
-- specs/deals/spec.md, "A pipeline stage can be protected as a
-- system stage".
-- ------------------------------------------------------------

-- BEFORE UPDATE: a system stage can't be renamed or moved out of
-- position 0. Colour is untouched by this check, so it stays
-- editable. A single `upsert` of the whole stage list (pipeline-
-- settings.tsx) aborts as one statement if any row trips this —
-- "no other stage's position changes" for free.
CREATE OR REPLACE FUNCTION pipeline_stages_protect_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system AND (NEW.name <> OLD.name OR NEW.position <> 0) THEN
    RAISE EXCEPTION 'pipeline_stages: the system stage cannot be renamed or moved out of position 0'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_stages_protect_update ON pipeline_stages;
CREATE TRIGGER pipeline_stages_protect_update
  BEFORE UPDATE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION pipeline_stages_protect_update();

-- BEFORE DELETE: a system stage can't be deleted directly. Deleting
-- the pipeline itself must still delete its system stage via
-- ON DELETE CASCADE (specs/deals/spec.md) — by the time the cascade
-- reaches this row, the parent `pipelines` row is already gone (the
-- FK cascade trigger runs after the parent delete, same
-- transaction), so that EXISTS check is false and the cascade is let
-- through. A standalone `DELETE FROM pipeline_stages` still sees its
-- pipeline and is refused.
CREATE OR REPLACE FUNCTION pipeline_stages_protect_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_system AND EXISTS (
    SELECT 1 FROM pipelines WHERE id = OLD.pipeline_id
  ) THEN
    RAISE EXCEPTION 'pipeline_stages: the system stage cannot be deleted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_stages_protect_delete ON pipeline_stages;
CREATE TRIGGER pipeline_stages_protect_delete
  BEFORE DELETE ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION pipeline_stages_protect_delete();

-- BEFORE INSERT: nothing may land in position 0 of a pipeline that
-- already has a system stage (keeps that slot reserved even for an
-- ordinary new stage), and only the service role may insert a row
-- with is_system = true (provisioning runs as service_role; every
-- client-facing insert runs as authenticated/anon).
CREATE OR REPLACE FUNCTION pipeline_stages_protect_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.position = 0 AND EXISTS (
    SELECT 1 FROM pipeline_stages s
    WHERE s.pipeline_id = NEW.pipeline_id AND s.is_system
  ) THEN
    RAISE EXCEPTION 'pipeline_stages: position 0 is reserved for the system stage'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_system AND current_user <> 'service_role' THEN
    RAISE EXCEPTION 'pipeline_stages: is_system can only be set by the service role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pipeline_stages_protect_insert ON pipeline_stages;
CREATE TRIGGER pipeline_stages_protect_insert
  BEFORE INSERT ON pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION pipeline_stages_protect_insert();

-- ============================================================
-- 2. accounts — Meta Conversions credentials
-- ============================================================
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS meta_dataset_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token TEXT;

COMMENT ON COLUMN accounts.meta_dataset_id IS
  'Meta Conversions API dataset id. Written only by provisioning (service role); never selectable by the authenticated role — see the column-level GRANT below.';

COMMENT ON COLUMN accounts.meta_access_token IS
  'AES-256-GCM ciphertext (encrypt() in src/lib/whatsapp/encryption.ts). Written only by provisioning (service role); never selectable by the authenticated role, never client-readable in any form.';

-- RLS is row-level and can't hide a column, so the two credential
-- columns are hidden by narrowing the table-level grant to an
-- explicit column list. service_role is untouched and keeps full
-- access. Safe: every existing query names its columns explicitly
-- (grepped the repository — nothing selects accounts.*), so a
-- select("*") added later fails loudly with a permission error
-- instead of silently leaking the token.
REVOKE SELECT ON accounts FROM authenticated;
GRANT SELECT (id, name, owner_user_id, default_currency, timezone, created_at, updated_at)
  ON accounts TO authenticated;

-- ============================================================
-- 3. profiles — password-change banner
-- ============================================================
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS password_banner_dismissed_at TIMESTAMPTZ;
