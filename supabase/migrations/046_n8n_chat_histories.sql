-- ============================================================
-- 046_n8n_chat_histories.sql — shared AI conversation memory
--
-- Replaces the per-client `n8n_chat_histories_<slug>` tables with one
-- shared table, kept in the exact column shape the N8N memory node
-- already writes in production today (proposal.md "Revisão desta
-- proposta"): id, session_id, message — no tenant/account column.
-- Isolation between tenants stays a convention of `session_id`
-- (`<account_id>:<phone>`), not a schema mechanism (design.md
-- "RLS: só onde é alcançável...").
--
-- RLS enabled with zero policies: Postgres denies all rows to any
-- non-owner role by default, so anon/authenticated get nothing even
-- though this is in `public` (exposed schema). service_role bypasses
-- RLS, so N8N keeps reading/writing once Epic 6 wires it up.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.n8n_chat_histories (
  id         bigserial PRIMARY KEY,
  session_id text NOT NULL,
  message    jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS n8n_chat_histories_session_id_idx
  ON public.n8n_chat_histories (session_id);

ALTER TABLE public.n8n_chat_histories ENABLE ROW LEVEL SECURITY;
