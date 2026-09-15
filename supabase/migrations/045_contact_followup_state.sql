-- ============================================================
-- 045_contact_followup_state.sql — AI follow-up state on contacts
--
-- Replaces the per-client `dados_cliente_<slug>` table with columns on
-- `public.contacts` (see proposal.md "Revisão desta proposta" and
-- design.md "Por que não uma tabela dados_leads separada"): contacts
-- already owns identity, account_id and RLS (017) plus normalized
-- phone (022) — this reuses that instead of duplicating it.
--
-- All columns nullable or defaulted, so every existing row is valid
-- with no backfill required. No new RLS policy: contacts_select/
-- _insert/_update/_delete (is_account_member, from 017) already cover
-- every column on the row, new ones included.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS nomewpp              text,
  ADD COLUMN IF NOT EXISTS status_followup      bigint NOT NULL DEFAULT -1,  -- -1 sem followup; 0..N = tentativa N
  ADD COLUMN IF NOT EXISTS proxima_tentativa_em timestamptz,
  ADD COLUMN IF NOT EXISTS followup_pausado     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ultima_mensagem      timestamptz,
  ADD COLUMN IF NOT EXISTS origem               text,        -- meta_ads | organico | indicacao
  ADD COLUMN IF NOT EXISTS utm_source           text,
  ADD COLUMN IF NOT EXISTS utm_medium           text,
  ADD COLUMN IF NOT EXISTS utm_campaign         text,
  ADD COLUMN IF NOT EXISTS ad_id                text;

-- Cron de follow-up do N8N: contatos com tentativa pendente, não
-- pausados, com follow-up ativo — sem varredura completa da tabela.
CREATE INDEX IF NOT EXISTS contacts_followup_pending_idx
  ON contacts (proxima_tentativa_em)
  WHERE followup_pausado = false AND status_followup >= 0;
