-- ============================================================
-- 044_lead_scheduling
--
-- The clinic books leads at a specific time of day, but
-- `expected_close_date DATE` only records a day with no hour.
-- Every downstream scheduling surface (this change's calendar,
-- later reminders, a follow-up queue) needs a timestamp.
--
-- `expected_close_date` is dropped, not migrated: it is a
-- forecast date on a pre-launch pipeline, and a date the operator
-- entered as "I expect to close around here" is not a time the
-- lead agreed to come in. Backfilling `scheduled_at` from it would
-- fill the new calendar with appointments nobody booked. Its
-- values are discarded. Operator running this migration by hand
-- can dump the column first if any row matters.
--
-- `scheduled_at TIMESTAMPTZ` stores an absolute instant.
-- `accounts.timezone` decides how that instant is written into an
-- input and read out of one — it does not change what moment is
-- stored. Defaults to 'America/Sao_Paulo'.
--
-- `appointment_confirmed_at` is a column only: no UI writes or
-- reads it in this change, a later reminder/confirmation change
-- owns it. Added here rather than in a second hand-run migration.
--
-- Deal status `won` is renamed to `qualified` (the clinic
-- qualifies a lead and books them, it does not "win" a deal).
-- Order matters: drop the constraint, update the rows, re-add the
-- constraint — reversing the first two would make the UPDATE fail
-- the old constraint.
--
-- Idempotent, following 002's pattern: safe to run multiple times.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS appointment_confirmed_at TIMESTAMPTZ;

ALTER TABLE deals
  DROP COLUMN IF EXISTS expected_close_date;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE INDEX IF NOT EXISTS idx_deals_scheduled_at ON deals(scheduled_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deals_status_check' AND conrelid = 'deals'::regclass
  ) THEN
    ALTER TABLE deals DROP CONSTRAINT deals_status_check;
  END IF;
END $$;

UPDATE deals SET status = 'qualified' WHERE status = 'won';

ALTER TABLE deals
  ADD CONSTRAINT deals_status_check CHECK (status IN ('open', 'qualified', 'lost'));
