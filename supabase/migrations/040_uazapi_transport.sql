-- ============================================================
-- 040_uazapi_transport
--
-- Replaces Meta's WhatsApp Cloud API with UAZAPI, an unofficial
-- gateway that pairs to an ordinary WhatsApp account by QR code. See
-- openspec/changes/replace-meta-with-uazapi/{proposal,design}.md for
-- the full rationale. This migration is the schema half; the
-- application-layer replacement lands alongside it in the same PR.
--
-- BREAKING. There is no down-migration: template data and Meta
-- credential columns are dropped outright. Cut this as a major
-- version with a database-backup instruction in the release notes —
-- every account has to reconnect WhatsApp by scanning a QR code
-- afterwards; there is no automatic carry-over from a Meta config.
--
-- Four things happen here, in dependency order:
--
--   1. whatsapp_config — swap Meta's phone-number-ID / WABA-ID /
--      access-token model for UAZAPI's instance-id / instance-token /
--      webhook-secret model (design.md D2/D3).
--   2. broadcasts — swap the template reference for a free-form
--      message body + optional media (design.md D5).
--   3. message_templates — dropped. Templates only existed to satisfy
--      Meta's approval requirement, which UAZAPI does not have.
--   4. Two stored functions that referenced the dropped
--      columns/table are redefined so they don't reference dead
--      schema: create_broadcast_with_recipients (broadcasts'
--      template_name/template_language → message_body/media) and
--      redeem_invitation (drops its message_templates existence
--      check — the table it queried is gone).
--
-- Idempotent — safe to re-run.
-- ============================================================

-- ============================================================
-- 1. whatsapp_config
-- ============================================================

-- 1a. New columns. All nullable — see design.md D2/D3: instance_id +
--     instance_token are set together at provision time, webhook_secret
--     + its hash at first callback registration, connection_state
--     defaults to 'disconnected' until the operator logs in, and
--     paired_phone/paired_at are only known once connected.
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS instance_id TEXT,
  ADD COLUMN IF NOT EXISTS instance_token TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS connection_state TEXT NOT NULL DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS paired_phone TEXT,
  ADD COLUMN IF NOT EXISTS paired_at TIMESTAMPTZ;

COMMENT ON COLUMN whatsapp_config.instance_id IS
  'UAZAPI gateway instance id, returned by POST /instance/create. One per account (design.md D2).';
COMMENT ON COLUMN whatsapp_config.instance_token IS
  'AES-256-GCM-encrypted UAZAPI instance token (same encrypt()/decrypt() as the old access_token). Authenticates every non-admin call for this instance.';
COMMENT ON COLUMN whatsapp_config.webhook_secret IS
  'AES-256-GCM-encrypted per-account callback secret. Kept (not just its hash) so the app can re-register the webhook URL on rotation or reconnect — see webhook_secret_hash.';
COMMENT ON COLUMN whatsapp_config.webhook_secret_hash IS
  'SHA-256 hex digest of webhook_secret, looked up by the callback route to resolve the account in constant time without decrypting every row (design.md D3, mirrors api_keys.key_hash).';
COMMENT ON COLUMN whatsapp_config.connection_state IS
  'Gateway connection state: disconnected | connecting | connected | hibernated. Mirrors GET /instance/status.';
COMMENT ON COLUMN whatsapp_config.paired_phone IS
  'E.164 WhatsApp number paired to the instance, set once connection_state reaches connected. Cleared on reset.';
COMMENT ON COLUMN whatsapp_config.paired_at IS
  'When connection_state last transitioned to connected. Cleared on reset.';

-- 1b. connection_state CHECK — same idempotent guard pattern as
--     message_templates.status (migration 014).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_config_connection_state_check'
      AND conrelid = 'whatsapp_config'::regclass
  ) THEN
    ALTER TABLE whatsapp_config
      ADD CONSTRAINT whatsapp_config_connection_state_check
      CHECK (connection_state IN ('disconnected', 'connecting', 'connected', 'hibernated'));
  END IF;
END $$;

-- 1c. Drop the Meta-only columns. Includes access_token, status, and
--     connected_at, which design.md's migration-plan bullet did not
--     spell out alongside phone_number_id/waba_id/verify_token/
--     registered_at/subscribed_apps_at/last_registration_error — but
--     access_token was Meta's bearer token (superseded by
--     instance_token), and status/connected_at ('connected' |
--     'disconnected', set from Meta verification) are superseded by
--     the richer connection_state/paired_at pair above. Leaving a
--     NOT NULL access_token column with nothing left to populate it
--     would break every future insert, so all three are dropped here
--     too — deviation noted in tasks.md 2.1.
ALTER TABLE whatsapp_config
  DROP COLUMN IF EXISTS phone_number_id,
  DROP COLUMN IF EXISTS waba_id,
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS verify_token,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS connected_at,
  DROP COLUMN IF EXISTS registered_at,
  DROP COLUMN IF EXISTS subscribed_apps_at,
  DROP COLUMN IF EXISTS last_registration_error;

-- 1d. Drop the phone_number_id UNIQUE constraint (013) and its
--     supporting registered_at index (015) — both name columns just
--     dropped above, but PostgreSQL only auto-drops a CHECK/index that
--     lives ON the dropped column; a table-level UNIQUE constraint and
--     a separately-named index survive a DROP COLUMN of a column they
--     reference only when... actually DROP COLUMN CASCADEs to any
--     constraint/index that references it, so these are already gone
--     by the time we get here. Guarded drops kept anyway so this
--     migration is self-documenting and safe to re-run against a
--     partially-migrated database.
ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
DROP INDEX IF EXISTS idx_whatsapp_config_registered_at;

-- 1e. Lookup index for the webhook callback. UNIQUE so two accounts
--     can never collide on a secret; a plain UNIQUE index tolerates
--     multiple NULLs (rows that haven't registered a callback yet),
--     which a hard NOT NULL could not (task 2.4).
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_config_webhook_secret_hash
  ON whatsapp_config (webhook_secret_hash);

-- ============================================================
-- 2. broadcasts — free-form body + media instead of a template ref
-- ============================================================
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS message_body TEXT,
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_kind TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT,
  ADD COLUMN IF NOT EXISTS variable_defaults JSONB;

COMMENT ON COLUMN broadcasts.message_body IS
  'Free-form message text, optionally containing {{field}} placeholders resolved per recipient. Media broadcasts use this as the caption. Replaces template_name/template_language (design.md D5).';
COMMENT ON COLUMN broadcasts.media_url IS
  'Optional attachment — a chat-media object URL, same convention as messages.media_url.';
COMMENT ON COLUMN broadcasts.media_kind IS
  'image | video | document | audio. NULL for a text-only broadcast.';
COMMENT ON COLUMN broadcasts.media_filename IS
  'Document-only — shown as the file name in the recipient''s chat.';
COMMENT ON COLUMN broadcasts.variable_defaults IS
  'User-supplied fallback value per {{field}} placeholder, applied when a recipient has no value for it. Replaces template_variables.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'broadcasts_media_kind_check'
      AND conrelid = 'broadcasts'::regclass
  ) THEN
    ALTER TABLE broadcasts
      ADD CONSTRAINT broadcasts_media_kind_check
      CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'document', 'audio'));
  END IF;
END $$;

-- Backfill: give every pre-existing row a body so the upcoming NOT
-- NULL-free app code has something sane to render for old campaigns
-- (the column itself stays nullable — a resend/resume of a very old
-- broadcast is out of scope, this is just so the list/detail views
-- don't show a blank message for history). Guarded on template_name
-- still existing so a second run of this migration (after that column
-- is dropped below) doesn't fail on an unknown column.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'broadcasts' AND column_name = 'template_name'
  ) THEN
    UPDATE broadcasts
    SET message_body = COALESCE(message_body, '[' || template_name || ']')
    WHERE message_body IS NULL;
  END IF;
END $$;

ALTER TABLE broadcasts
  DROP COLUMN IF EXISTS template_name,
  DROP COLUMN IF EXISTS template_language,
  DROP COLUMN IF EXISTS template_variables;

-- ============================================================
-- 3. message_templates — dropped entirely (design.md D5)
--
-- No FK references this table's id from elsewhere in the schema, so a
-- plain DROP is sufficient; its own policies/triggers/indexes go with
-- it automatically.
-- ============================================================
DROP TABLE IF EXISTS message_templates;

-- ============================================================
-- 4a. create_broadcast_with_recipients — retarget at the new columns
--
-- Dropped rather than CREATE OR REPLACE'd (same reasoning as
-- migration 038): the parameter list is changing shape, and a
-- REPLACE with a different signature creates a second overload
-- instead of retiring the old one.
-- ============================================================
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[]
);
DROP FUNCTION IF EXISTS public.create_broadcast_with_recipients(
  UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]
);

CREATE OR REPLACE FUNCTION public.create_broadcast_with_recipients(
  p_account_id       UUID,
  p_user_id          UUID,
  p_name             TEXT,
  p_message_body     TEXT,
  p_media_url        TEXT,
  p_media_kind       TEXT,
  p_media_filename   TEXT,
  p_total_recipients INTEGER,
  p_contact_ids      UUID[],
  p_variable_values  JSONB[]
)
RETURNS TABLE(broadcast_id UUID, recipient_id UUID, contact_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_broadcast_id UUID;
BEGIN
  INSERT INTO broadcasts (
    account_id, user_id, name, message_body,
    media_url, media_kind, media_filename,
    status, total_recipients
  )
  VALUES (
    p_account_id, p_user_id, p_name, p_message_body,
    p_media_url, p_media_kind, p_media_filename,
    'sending', p_total_recipients
  )
  RETURNING id INTO v_broadcast_id;

  -- Two-array unnest pairs each contact with its resolved variables
  -- positionally. A shorter values array pads with NULL, which the
  -- resume path reads as "no variables to re-apply".
  RETURN QUERY
  WITH ins AS (
    INSERT INTO broadcast_recipients (
      broadcast_id, contact_id, status, template_params
    )
    SELECT v_broadcast_id, t.cid, 'pending', t.vars
    FROM unnest(p_contact_ids, p_variable_values) AS t(cid, vars)
    RETURNING id, contact_id
  )
  SELECT v_broadcast_id, ins.id, ins.contact_id
  FROM ins;
END;
$$;

REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM anon;
REVOKE ALL ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_broadcast_with_recipients(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, UUID[], JSONB[]) TO service_role;

-- ============================================================
-- 4b. redeem_invitation — drop the message_templates existence check
--
-- Migration 019 has this function probe `message_templates` (now
-- dropped) as one of several "does the joining account already have
-- data" guards. CREATE OR REPLACE with the identical signature; only
-- the removed UNION ALL branch changes.
-- ============================================================
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID  -- the joined account_id
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  -- Caller's current account + its owner.
  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id;

  IF v_old_account_id IS NULL THEN
    -- Defensive — every authenticated user has a profile post-017.
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  -- Edge case: the inviter sent themselves a link, or the
  -- caller is somehow already in the inviter's account.
  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  -- Safety: the caller must be the SOLE OWNER of their current
  -- account (i.e. their fresh personal account from signup or a
  -- prior removal). Any other state means they're either:
  --   - a member of another shared account (joining a second
  --     would silently orphan their access to the first), or
  --   - the owner of an account with teammates (they'd abandon
  --     their team to join the inviter's).
  -- Either way, the safe answer is "make a different login".
  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Belt: even if they own their account, refuse if it has any
  -- domain data — joining would orphan their contacts, deals,
  -- broadcasts, automations, flows, etc. (message_templates dropped
  -- in migration 040 — no longer part of this check.)
  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  -- Move the profile first so the cascade-on-delete of the old
  -- account doesn't try to nuke this user's profile too.
  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  -- Clean up the orphan personal account. Empty by the checks
  -- above, so this is purely housekeeping — no cascades fire
  -- because no other rows reference it.
  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;

ALTER FUNCTION public.redeem_invitation(TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(TEXT) TO authenticated;
