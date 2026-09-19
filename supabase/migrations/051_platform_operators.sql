-- ============================================================
-- 051_platform_operators.sql — platform operators move from an env
-- var into the database
--
-- Effect's own staff, not a clinic's own users (see
-- openspec/changes/platform-admin-profiles/{proposal,design}.md).
-- `PLATFORM_ADMINS` survives as a bootstrap seed: any address in it
-- is a manager whether or not a row exists here, resolved in
-- application code BEFORE this table is ever read (design.md D3) —
-- that ordering is what keeps a deployment from locking itself out
-- when the database is unreachable. Every write to this table goes
-- through the service-role client; the policy below only ever lets a
-- session read its own row, which is all src/middleware.ts needs to
-- resolve the caller's own operator status under their own session.
--
-- Applied by hand in the Supabase SQL editor, like every migration in
-- this project. Idempotent — safe to re-run.
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_operators (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('manager', 'admin')),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE platform_operators IS
  'Platform operators (Effect staff), keyed to their sign-in identity. The environment seed (PLATFORM_ADMINS) is resolved in application code before this table is ever read, and always wins as the manager role, so a deployment can never lock itself out. Every write goes through the service-role client — the RLS policy below grants only a read of one''s own row.';

ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_operators_read_own ON platform_operators;
CREATE POLICY platform_operators_read_own ON platform_operators
  FOR SELECT
  USING (user_id = auth.uid());
