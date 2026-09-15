-- ============================================================
-- 042_deal_custom_fields.sql — Typed deal custom fields, deal
-- note history, and additional built-in deal attributes.
--
-- What this migration adds
--   1. `deal_field_type` and `deal_priority` enums.
--   2. `deal_custom_fields` — the account-wide, settings-class
--      catalogue of typed field definitions. Separate from
--      `custom_fields` (contacts) by design; see design.md D1.
--   3. `deal_custom_values` — one value per (deal, field),
--      stored as TEXT and interpreted by the definition's type
--      (design.md D2). Operational-class RLS.
--   4. `deal_notes` — appendable, attributed note history,
--      mirroring `contact_notes`, plus a backfill of the
--      existing `deals.notes` text into a first entry.
--   5. `probability`, `priority`, `source`, `description`, and
--      `lost_reason` columns on `deals`.
--
-- What this migration does NOT do
--   - Drop `deals.notes`. It is retained (and commented as
--     dormant) so this migration is rollback-safe and any
--     existing API/webhook consumer keeps reading. A later
--     cleanup migration can remove it.
--   - Touch `custom_fields` / `contact_custom_values`. Contact
--     fields keep their text-only behaviour.
--
-- Idempotent — safe to re-run. New objects use IF NOT EXISTS,
-- policies and constraints are dropped before recreate, and the
-- notes backfill is guarded by NOT EXISTS.
-- ============================================================

-- ============================================================
-- TYPES
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_field_type') THEN
    CREATE TYPE deal_field_type AS ENUM ('text', 'number', 'date', 'select', 'checkbox');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'deal_priority') THEN
    CREATE TYPE deal_priority AS ENUM ('low', 'medium', 'high');
  END IF;
END $$;

-- ============================================================
-- DEAL_CUSTOM_FIELDS — the definition catalogue
--
-- account_id is tenancy; user_id is audit (who created it), the
-- same split every table has used since migration 017.
--
-- `field_options` holds `{"options": ["A", "B"]}` for `select`
-- and is NULL for every other type. The CHECK enforces that a
-- `select` definition can never be saved without at least one
-- option — the one type invariant Postgres can police without
-- reading a sibling row.
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_custom_fields (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_name   TEXT NOT NULL,
  field_type   deal_field_type NOT NULL DEFAULT 'text',
  field_options JSONB,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE deal_custom_fields
  DROP CONSTRAINT IF EXISTS deal_custom_fields_select_has_options;
ALTER TABLE deal_custom_fields
  ADD CONSTRAINT deal_custom_fields_select_has_options CHECK (
    field_type <> 'select'
    OR (
      jsonb_typeof(field_options -> 'options') = 'array'
      AND jsonb_array_length(field_options -> 'options') > 0
    )
  );

ALTER TABLE deal_custom_fields
  DROP CONSTRAINT IF EXISTS deal_custom_fields_name_not_blank;
ALTER TABLE deal_custom_fields
  ADD CONSTRAINT deal_custom_fields_name_not_blank
    CHECK (btrim(field_name) <> '');

-- Case-insensitive uniqueness per account, so "Contract" and
-- "contract" cannot both exist. The app checks this too and
-- reports a friendly error; the index is the backstop against a
-- race between two admins.
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_custom_fields_account_name
  ON deal_custom_fields (account_id, lower(field_name));

CREATE INDEX IF NOT EXISTS idx_deal_custom_fields_account_position
  ON deal_custom_fields (account_id, position, field_name);

ALTER TABLE deal_custom_fields ENABLE ROW LEVEL SECURITY;

-- Settings-class: any member reads, admin+ writes. Same split as
-- the `custom_fields` policies in migration 017.
DROP POLICY IF EXISTS deal_custom_fields_select ON deal_custom_fields;
CREATE POLICY deal_custom_fields_select ON deal_custom_fields
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS deal_custom_fields_insert ON deal_custom_fields;
CREATE POLICY deal_custom_fields_insert ON deal_custom_fields
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS deal_custom_fields_update ON deal_custom_fields;
CREATE POLICY deal_custom_fields_update ON deal_custom_fields
  FOR UPDATE USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS deal_custom_fields_delete ON deal_custom_fields;
CREATE POLICY deal_custom_fields_delete ON deal_custom_fields
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS set_updated_at ON deal_custom_fields;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_custom_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE deal_custom_fields IS
  'Account-wide catalogue of typed custom field definitions that apply to '
  'every deal in the account. Separate from `custom_fields`, which is the '
  'contact catalogue — a definition here never appears on a contact.';

COMMENT ON COLUMN deal_custom_fields.field_options IS
  'Type-specific configuration. For field_type = ''select'' this is '
  '{"options": ["...", "..."]} with at least one entry (enforced by '
  'deal_custom_fields_select_has_options). NULL for every other type.';

-- ============================================================
-- DEAL_CUSTOM_VALUES — one value per (deal, field)
--
-- No account_id column: tenancy is inherited through `deals`,
-- exactly as `contact_custom_values` inherits through `contacts`.
-- Values are TEXT and parsed against the definition's type in
-- application code (design.md D2).
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_custom_values (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  field_id   UUID NOT NULL REFERENCES deal_custom_fields(id) ON DELETE CASCADE,
  value      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (deal_id, field_id)
);

-- Reading every value for one deal (the detail view).
CREATE INDEX IF NOT EXISTS idx_deal_custom_values_deal
  ON deal_custom_values (deal_id);

-- Board filtering: "which deals have <field> = <value>". Leading
-- column is field_id so the scan is confined to the one field
-- being filtered on. See design.md D3.
CREATE INDEX IF NOT EXISTS idx_deal_custom_values_field_value
  ON deal_custom_values (field_id, value);

ALTER TABLE deal_custom_values ENABLE ROW LEVEL SECURITY;

-- Operational-class: any member reads, agent+ writes — authorized
-- through the owning deal, mirroring the contact_custom_values
-- policies in migration 017.
DROP POLICY IF EXISTS deal_custom_values_select ON deal_custom_values;
CREATE POLICY deal_custom_values_select ON deal_custom_values
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = deal_custom_values.deal_id
        AND is_account_member(d.account_id)
    )
  );

DROP POLICY IF EXISTS deal_custom_values_modify ON deal_custom_values;
CREATE POLICY deal_custom_values_modify ON deal_custom_values
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = deal_custom_values.deal_id
        AND is_account_member(d.account_id, 'agent')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = deal_custom_values.deal_id
        AND is_account_member(d.account_id, 'agent')
    )
  );

DROP TRIGGER IF EXISTS set_updated_at ON deal_custom_values;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_custom_values
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- DEAL_NOTES — appendable, attributed history
--
-- Unlike contact_notes.user_id (NOT NULL, ON DELETE CASCADE),
-- the author here is nullable and ON DELETE SET NULL: a note is
-- history, so removing a teammate should orphan the attribution
-- rather than delete what they wrote. See design.md D4.
-- ============================================================
CREATE TABLE IF NOT EXISTS deal_notes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id    UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note_text  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Newest-first read of one deal's history.
CREATE INDEX IF NOT EXISTS idx_deal_notes_deal_created
  ON deal_notes (deal_id, created_at DESC);

ALTER TABLE deal_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_notes_select ON deal_notes;
CREATE POLICY deal_notes_select ON deal_notes
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = deal_notes.deal_id
        AND is_account_member(d.account_id)
    )
  );

DROP POLICY IF EXISTS deal_notes_modify ON deal_notes;
CREATE POLICY deal_notes_modify ON deal_notes
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = deal_notes.deal_id
        AND is_account_member(d.account_id, 'agent')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM deals d
      WHERE d.id = deal_notes.deal_id
        AND is_account_member(d.account_id, 'agent')
    )
  );

-- ============================================================
-- DEALS — additional built-in attributes
--
-- All nullable: "unset" must stay distinguishable from 0 / 'low'
-- / '' so the board and analytics can treat them as absent.
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS probability  SMALLINT,
  ADD COLUMN IF NOT EXISTS priority     deal_priority,
  ADD COLUMN IF NOT EXISTS source       TEXT,
  ADD COLUMN IF NOT EXISTS description  TEXT,
  ADD COLUMN IF NOT EXISTS lost_reason  TEXT;

ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_probability_range;
ALTER TABLE deals ADD CONSTRAINT deals_probability_range
  CHECK (probability IS NULL OR (probability >= 0 AND probability <= 100));

COMMENT ON COLUMN deals.probability IS
  'Win likelihood, 0-100. NULL means not estimated — distinct from 0.';

COMMENT ON COLUMN deals.lost_reason IS
  'Free text captured when the deal is marked lost. Deliberately NOT cleared '
  'on reopen, so the history of why it was lost survives.';

COMMENT ON COLUMN deals.notes IS
  'DORMANT since migration 042 — deal notes moved to the `deal_notes` table. '
  'Retained so this migration stays rollback-safe and existing API/webhook '
  'consumers keep reading. Not written by the app. Remove in a later cleanup.';

-- ============================================================
-- BACKFILL — existing deals.notes text becomes the first entry
--
-- Attributed to the deal's own user_id (the closest thing to an
-- author we have) and timestamped at the deal's last update, so
-- the entry does not claim to have been written just now.
--
-- The NOT EXISTS guard makes a re-run a no-op rather than
-- duplicating every note.
-- ============================================================
INSERT INTO deal_notes (deal_id, user_id, note_text, created_at)
SELECT
  d.id,
  d.user_id,
  d.notes,
  COALESCE(d.updated_at, d.created_at, NOW())
FROM deals d
WHERE d.notes IS NOT NULL
  AND btrim(d.notes) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM deal_notes n WHERE n.deal_id = d.id
  );
