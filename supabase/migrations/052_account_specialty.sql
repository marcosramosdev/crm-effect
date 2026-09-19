-- ============================================================
-- 052_account_specialty.sql — record the clinic's health specialty
--
-- health-specialties-and-funnel-templates: specialty and funnel model
-- become two independent provisioning choices. This migration only
-- adds storage for the specialty side — the funnel model stays code
-- (four models in src/lib/provisioning/templates.ts), never a column.
--
-- Both columns are nullable: every account provisioned before this
-- change has neither, which is the "no specialty recorded" state the
-- admin-console delta expects. No backfill.
--
-- specialty holds one of the sixteen keys from templates.ts (fourteen
-- Conselho Nacional de Saúde professions, "aesthetics-cosmetology",
-- "other"). No CHECK constraint enumerating them: the list is expected
-- to move faster than migrations, and the provisioning route already
-- rejects an unknown key before anything is created (design.md D5).
--
-- specialty_other holds the free text and is written only when
-- specialty = 'other'; the application normalises it to NULL for every
-- other specialty, so the stored row can never claim a niche the
-- specialty contradicts.
--
-- Applied by hand in the Supabase SQL editor, like every migration in
-- this project. Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS specialty TEXT,
  ADD COLUMN IF NOT EXISTS specialty_other TEXT;

COMMENT ON COLUMN accounts.specialty IS
  'The clinic''s health niche, chosen at provisioning from the fixed list in src/lib/provisioning/templates.ts. Describes the clinic and decides nothing else. NULL for accounts provisioned before this column existed.';

COMMENT ON COLUMN accounts.specialty_other IS
  'Free text naming the niche when specialty = ''other''. NULL for every other specialty.';
