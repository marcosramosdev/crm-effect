-- ============================================================
-- 041_inbound_default_pipeline
--
-- Opt-in: an account can nominate one pipeline + stage that every
-- WhatsApp contact CREATED by the inbound webhook is dropped into as a
-- fresh deal. Today a deal is only ever auto-created if the operator
-- hand-builds a `create_deal` automation; this makes "new WhatsApp
-- lead lands here" a first-class, one-setting choice.
--
-- Both columns live on `whatsapp_config` (not `accounts`) because the
-- webhook already SELECTs one whatsapp_config row per event — reading
-- the setting there costs nothing extra. See
-- openspec/changes/contact-pipeline-transfer-and-voice-notes/design.md D1.
--
-- ON DELETE SET NULL on both FKs means deleting the referenced
-- pipeline OR stage nulls the column, and the webhook's "both columns
-- set" guard then simply skips seeding — no application code needed
-- for the deleted-pipeline case.
--
-- No backfill: NULL means "unchanged behaviour", which is exactly the
-- pre-migration state.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS inbound_default_pipeline_id UUID
    REFERENCES pipelines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inbound_default_stage_id UUID
    REFERENCES pipeline_stages(id) ON DELETE SET NULL;

COMMENT ON COLUMN whatsapp_config.inbound_default_pipeline_id IS
  'Opt-in. When set (together with inbound_default_stage_id), the inbound '
  'webhook creates one open deal on this pipeline for every contact it '
  'newly creates while ingesting a message. NULL (the default, and after '
  'the pipeline is deleted) disables the behaviour.';

COMMENT ON COLUMN whatsapp_config.inbound_default_stage_id IS
  'Landing stage for inbound_default_pipeline_id. Must belong to that '
  'pipeline. Nulled by ON DELETE SET NULL if the stage is removed, which '
  'disables auto-seeding until the setting is re-chosen.';
