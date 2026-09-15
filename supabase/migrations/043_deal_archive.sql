-- ============================================================
-- 043_deal_archive
--
-- Adds an "archived" state to deals, independent of the
-- open / won / lost status. A deal is archived to clear it off
-- the pipeline board without claiming an outcome (lost) or
-- destroying the record (delete). A won or lost deal can still
-- be archived and stays won / lost.
--
-- `archived_at` is a nullable timestamp that doubles as the
-- flag (NULL = active) and an audit of when it happened,
-- matching the house style for `lost_reason` and the audit
-- columns. No backfill: every existing deal is already
-- NULL = active.
--
-- SCOPE: archive is a BOARD-VIEW concern only. Only the
-- pipeline board's deal load (and, transitively, its per-stage
-- counts / totals and the board analytics) filters on
-- `archived_at`. Every other `deals` read — the public /api/v1,
-- the webhook, automations, analytics exports — is deliberately
-- unaffected and still returns archived deals. A later need for
-- one of those to skip archived deals is a new requirement, not
-- a bug in this migration.
--
-- No RLS change — `archived_at` is an operational column on
-- `deals` and the existing agent-write / member-read policies
-- already cover it.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN deals.archived_at IS
  'When the deal was archived; NULL = active (not archived). '
  'Archive is a pipeline-board-view concern only: the board load '
  'filters on this column, but every other deals read (/api/v1, '
  'the webhook, automations, exports) ignores it and still '
  'returns archived deals. Independent of status — a won or lost '
  'deal can be archived and keeps its status.';

-- Partial index keeping the board's main `WHERE archived_at IS NULL`
-- read cheap as archived rows accumulate.
CREATE INDEX IF NOT EXISTS idx_deals_active
  ON deals (pipeline_id)
  WHERE archived_at IS NULL;
