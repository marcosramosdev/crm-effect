-- ============================================================
-- 047_followup_dispatch.sql — pg_cron-driven follow-up dispatch
--
-- See openspec/changes/n8n-fluxos-provisionamento/design.md, Decisões
-- 3-6. One function + one cron job for every tenant, cadence per
-- tenant in `platform.tenant_vars` (key = 'followup'):
--   {"janelas_min": [2880, 5760, 10080], "webhook_url": "https://..."}
--
-- `status_followup` stops being a sentinel (-1 = never enrolled) and
-- becomes a pure attempt counter starting at 0; the permanent stop is
-- `followup_pausado` (045 already added the column, unused until now).
-- `proxima_tentativa_em` stops being a precomputed schedule and
-- becomes a short dispatch reservation guarding against double-send
-- while N8N is in flight (Decisão 5).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ------------------------------------------------------------
-- platform.n8n_workflows: tenant_id nullable (global workflows, e.g.
-- the shared transfer flow), kind accepts 'transferir'.
-- ------------------------------------------------------------
ALTER TABLE platform.n8n_workflows
  ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE platform.n8n_workflows
  DROP CONSTRAINT IF EXISTS n8n_workflows_kind_check;
ALTER TABLE platform.n8n_workflows
  ADD CONSTRAINT n8n_workflows_kind_check
  CHECK (kind IN ('atendimento', 'followup', 'transferir'));

-- ------------------------------------------------------------
-- contacts.status_followup: -1 sentinel → 0-based pure counter.
-- Default first, then backfill existing rows, per the migration plan
-- in design.md (backfill after the default swap).
-- ------------------------------------------------------------
ALTER TABLE contacts
  ALTER COLUMN status_followup SET DEFAULT 0;

UPDATE contacts
  SET status_followup = 0
  WHERE status_followup < 0;

-- ------------------------------------------------------------
-- Follow-up scan index: the trigger is silence since `ultima_mensagem`
-- (Decisão 4), not the old `proxima_tentativa_em` schedule. The old
-- index's `status_followup >= 0` guard is gone too — 0 is now a valid,
-- common value (nobody has been attempted yet), not a sentinel to
-- exclude.
-- ------------------------------------------------------------
DROP INDEX IF EXISTS contacts_followup_pending_idx;
CREATE INDEX IF NOT EXISTS contacts_followup_pending_idx
  ON contacts (account_id, ultima_mensagem)
  WHERE followup_pausado = false;

-- ------------------------------------------------------------
-- platform.disparar_followup(): one pass over every tenant with a
-- 'followup' cadence configured. For each contact whose silence has
-- reached the window for their next attempt, reserve the dispatch
-- (proxima_tentativa_em = now() + reserve window) and fire the
-- tenant's follow-up webhook via pg_net (fire-and-forget; response
-- lands in net._http_response). The reservation is what stops the
-- next minute's tick from re-dispatching the same contact before N8N
-- has registered the send (Decisão 5) — N8N clears the column and
-- bumps status_followup when it does.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION platform.disparar_followup()
RETURNS void
LANGUAGE sql
AS $$
  WITH candidatos AS (
    UPDATE contacts c
    SET proxima_tentativa_em = now() + interval '2 minutes'
    FROM platform.tenant_vars v
    JOIN platform.tenants t ON t.id = v.tenant_id
    WHERE v.key = 'followup'
      AND t.account_id = c.account_id
      AND c.followup_pausado = false
      AND c.ultima_mensagem IS NOT NULL
      AND c.status_followup < jsonb_array_length(v.value -> 'janelas_min')
      AND now() - c.ultima_mensagem >=
          ((v.value -> 'janelas_min' ->> c.status_followup::int)::int) * interval '1 minute'
      AND (c.proxima_tentativa_em IS NULL OR c.proxima_tentativa_em <= now())
    RETURNING
      c.id AS contact_id,
      c.account_id,
      c.phone,
      c.name,
      c.status_followup,
      v.value ->> 'webhook_url' AS webhook_url
  )
  SELECT net.http_post(
    url := candidatos.webhook_url,
    body := jsonb_build_object(
      'contact_id', candidatos.contact_id,
      'account_id', candidatos.account_id,
      'phone', candidatos.phone,
      'name', candidatos.name,
      'status_followup', candidatos.status_followup
    )
  )
  FROM candidatos;
$$;

-- ------------------------------------------------------------
-- Single cron job for every tenant. Idempotent: re-scheduling under
-- the same name would otherwise duplicate the row on a second apply.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'disparar_followup') THEN
    PERFORM cron.unschedule('disparar_followup');
  END IF;
END
$$;

SELECT cron.schedule('disparar_followup', '* * * * *', 'SELECT platform.disparar_followup();');
