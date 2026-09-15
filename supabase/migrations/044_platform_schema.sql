-- ============================================================
-- 044_platform_schema.sql — schema `platform`
--
-- First migration of the zero7IA platform layer, separate from the
-- CRM's `public` schema (docs/prd.md "Schema platform (novo)"). 12
-- tables: tenant, tenant vars, N8N instance/workflow tracking, agent +
-- immutable prompt versions, provisioning run/step, critical event
-- queue, subscription, daily usage, audit log.
--
-- `agents.published_version_id` and `agent_versions.agent_id` form a
-- circular reference — `agents` is created first without the FK,
-- `agent_versions` next, and the FK is added at the end of this file
-- once both tables exist (docs/prd.md already orders it this way).
--
-- No RLS on any table here: `platform` is not listed in
-- `config.toml [api] schemas`, so PostgREST never exposes it to
-- anon/authenticated regardless of RLS — see design.md "RLS: só onde
-- é alcançável por uma role que não é service_role". Idempotent
-- (IF NOT EXISTS) like every migration in this repo.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS platform;

-- Cliente da zero7IA. 1:1 com accounts do CRM.
CREATE TABLE IF NOT EXISTS platform.tenants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES public.accounts(id) ON DELETE RESTRICT,
  slug                text NOT NULL UNIQUE,          -- odonto-excellence-curitiba
  name                text NOT NULL,
  niche               text NOT NULL,                 -- odonto | psiquiatria | estetica
  status              text NOT NULL DEFAULT 'provisioning'
                        CHECK (status IN ('provisioning','awaiting_pairing','active','suspended','cancelled')),
  subscription_status text NOT NULL DEFAULT 'pending'
                        CHECK (subscription_status IN ('pending','active','past_due','cancelled')),
  timezone            text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

-- Variáveis do cliente que entram no prompt. Preço, endereço e
-- convênios mudam sem aviso — não podem ser texto solto dentro do
-- prompt.
CREATE TABLE IF NOT EXISTS platform.tenant_vars (
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,        -- endereco, horario, investimento, convenios, whatsapp
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS platform.n8n_instances (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  base_url    text NOT NULL,
  api_key_enc text NOT NULL,       -- AES-256-GCM, mesma chave do CRM
  status      text NOT NULL DEFAULT 'active',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.n8n_workflows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  instance_id    uuid NOT NULL REFERENCES platform.n8n_instances(id) ON DELETE RESTRICT,
  workflow_id    text NOT NULL,    -- id no N8N
  kind           text NOT NULL DEFAULT 'atendimento'
                   CHECK (kind IN ('atendimento','followup')),
  webhook_path   text,
  active         boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, workflow_id)
);

CREATE TABLE IF NOT EXISTS platform.agents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  name                 text NOT NULL,                 -- Recepção, Helena
  model                text NOT NULL,                 -- gpt-5.x
  params               jsonb NOT NULL DEFAULT '{}',   -- temperature, max_tokens
  template_ref         text NOT NULL,                 -- packages/prompts/psiquiatria.md
  published_version_id uuid,
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','active','paused')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

-- Imutável. Registro do que foi publicado; rollback = re-push de uma
-- linha antiga.
CREATE TABLE IF NOT EXISTS platform.agent_versions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES platform.agents(id) ON DELETE CASCADE,
  version         integer NOT NULL,
  git_sha         text NOT NULL,
  template_ref    text NOT NULL,
  rendered_prompt text NOT NULL,     -- vars do tenant resolvidas; expressões n8n ($now) preservadas
  vars_snapshot   jsonb NOT NULL,
  published_by    uuid,
  published_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version)
);

-- FK circular: só pode existir depois que as duas tabelas já
-- existem — por isso vem depois no arquivo, não em migration própria.
ALTER TABLE platform.agents
  DROP CONSTRAINT IF EXISTS agents_published_version_fk;
ALTER TABLE platform.agents
  ADD CONSTRAINT agents_published_version_fk
  FOREIGN KEY (published_version_id) REFERENCES platform.agent_versions(id);

-- Provisionamento como processo, não como sequência de requests.
CREATE TABLE IF NOT EXISTS platform.provisioning_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'running'
                CHECK (status IN ('running','succeeded','failed','aborted')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  error       text
);

CREATE TABLE IF NOT EXISTS platform.provisioning_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          uuid NOT NULL REFERENCES platform.provisioning_runs(id) ON DELETE CASCADE,
  step_key        text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  attempts        integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,   -- tenant_id + step_key
  input           jsonb,
  output          jsonb,
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Entrega garantida dos eventos que não podem sumir.
CREATE TABLE IF NOT EXISTS platform.critical_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('risco','urgencia','pagamento')),
  lead_id           uuid,
  payload           jsonb NOT NULL,
  notified_at       timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0,
  last_error        text,
  acknowledged_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS critical_events_unacknowledged_idx
  ON platform.critical_events (kind, acknowledged_at, created_at)
  WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS platform.subscriptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  provider       text NOT NULL DEFAULT 'mercadopago',
  preapproval_id text UNIQUE,
  status         text NOT NULL,
  amount_cents   integer,
  next_charge_at timestamptz,
  raw            jsonb,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.usage_daily (
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  day           date NOT NULL,
  inbound_msgs  integer NOT NULL DEFAULT 0,
  outbound_msgs integer NOT NULL DEFAULT 0,
  ai_replies    integer NOT NULL DEFAULT 0,
  tokens_in     bigint  NOT NULL DEFAULT 0,
  tokens_out    bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);

CREATE TABLE IF NOT EXISTS platform.audit_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  actor_type    text NOT NULL CHECK (actor_type IN ('staff','system','n8n','client')),
  tenant_id     uuid,
  action        text NOT NULL,       -- prompt.publish, tenant.suspend, tenant.impersonate
  target        text,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_created_idx
  ON platform.audit_log (tenant_id, created_at DESC);

-- updated_at triggers, reusing the trigger function from 001 (same
-- pattern as contacts/profiles/conversations/whatsapp_config).
DROP TRIGGER IF EXISTS set_updated_at ON platform.tenants;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform.tenants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON platform.tenant_vars;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform.tenant_vars
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON platform.agents;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform.agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at ON platform.subscriptions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform.subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
