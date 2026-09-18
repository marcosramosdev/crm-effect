-- ============================================================
-- 049_meta_capi_manual_mark.sql — the conversion mark replaces the
-- deal status as the reporting trigger
--
-- See openspec/changes/meta-capi-manual-qualification/design.md
-- (D1 the column, D2 the event_time, D3 the trigger branch, D4 the
-- cancel, D5 the revive, D6 the historical rows).
--
-- What this migration changes
--   1. `deals.meta_qualified_at` — the operator's explicit decision
--      that this lead is worth reporting to Meta. Independent of
--      `status`: qualifying a deal is a sales outcome, marking it is
--      an advertising decision, and neither implies the other.
--   2. `canceled` joins the `meta_capi_events` status CHECK.
--   3. `meta_capi_enqueue()` branches on the mark transition instead
--      of on the status, and gains the cancel (unmark) and the revive
--      (re-mark) paths.
--   4. The status-keyed trigger is replaced by a mark-keyed one.
--      Qualifying, losing, reopening, dragging or archiving a deal
--      now records nothing at all.
--   5. Rows enqueued by the old rule are canceled. None was ever
--      delivered — delivery is still gated on the D0 experiment of
--      meta-capi-qualified-lead — and none carries an operator's
--      decision, so leaving them `pending` would make the first thing
--      delivery ever does the exact automatic reporting this change
--      removes.
--
-- Idempotent — safe to re-run: ADD COLUMN IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS … ADD, CREATE OR REPLACE, DROP … CREATE,
-- and the one-time cancel is bounded by `meta_qualified_at IS NULL`
-- so a later re-run cannot touch a conversion an operator did choose.
-- Applied by hand in the Supabase SQL editor, like every migration in
-- this project.
-- ============================================================

-- ============================================================
-- 1. deals — the conversion mark (design.md D1)
-- ============================================================
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS meta_qualified_at TIMESTAMPTZ;

COMMENT ON COLUMN deals.meta_qualified_at IS
  'When an operator marked this lead as worth reporting to Meta as a conversion. NULL = not marked, the default for every deal. Independent of status and of archived_at — the status is the clinic''s sales outcome, this is the advertising decision. Setting it enqueues a conversion, clearing it cancels an undelivered one (migration 049 trigger below). Written from the browser under RLS, so nothing outward-facing trusts its value: meta_capi_events.event_time comes from now() in the trigger (design.md D2).';

-- ============================================================
-- 2. meta_capi_events — the `canceled` state (design.md D4)
--
-- Re-created rather than added to: CHECK constraints have no
-- IF NOT EXISTS form, and this is the only place the state list
-- lives. Runs before anything can write the new value.
-- ============================================================
ALTER TABLE meta_capi_events
  DROP CONSTRAINT IF EXISTS meta_capi_events_status_check;
ALTER TABLE meta_capi_events
  ADD CONSTRAINT meta_capi_events_status_check CHECK (
    status IN ('pending','unconfigured','sending','sent','failed','expired','canceled')
  );

COMMENT ON COLUMN meta_capi_events.status IS
  'unconfigured rows are historical and never revive (meta-capi-qualified-lead design.md D3). canceled rows are the ones an operator unmarked before delivery (049 design.md D4); re-marking the deal revives exactly that row. The claim query for delivery must select neither.';

-- ============================================================
-- 3. The enqueue / cancel / revive function (design.md D3–D5)
--
-- SECURITY DEFINER for the same reason as in 048: the trigger runs as
-- whichever role wrote the deal — `authenticated` for every browser
-- writer — and migration 046 revoked SELECT ON accounts from that
-- role. Without it, marking a card fails in the browser.
-- ============================================================
CREATE OR REPLACE FUNCTION meta_capi_enqueue()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctwa_clid    TEXT;
  v_ctwa_clid_at TIMESTAMPTZ;
  v_dataset_id   TEXT;
  v_event_name   TEXT;
  v_status       TEXT;
BEGIN
  -- Unmark: cancel whatever has not left the system yet. `sent` is a
  -- fact about Meta's side and stays; `sending` / `failed` / `expired`
  -- belong to the delivery pass, which must not lose a row from under
  -- itself mid-flight (design.md D4).
  IF TG_OP = 'UPDATE'
     AND OLD.meta_qualified_at IS NOT NULL
     AND NEW.meta_qualified_at IS NULL THEN
    BEGIN
      UPDATE meta_capi_events
         SET status = 'canceled'
       WHERE deal_id = NEW.id
         AND status IN ('pending','unconfigured');
    EXCEPTION WHEN OTHERS THEN
      -- Same rule as the insert below: an outbox bug must never cost
      -- the clinic their own write.
      RAISE WARNING 'meta_capi_enqueue: failed to cancel for deal %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
  END IF;

  -- Only the unmarked -> marked transition enqueues. AFTER UPDATE OF
  -- <column> fires whenever the column appears in the SET list,
  -- changed or not (the pipeline board writes whole rows), so a
  -- re-stamp of an already-set mark must do nothing — it is not a new
  -- decision.
  IF TG_OP = 'UPDATE'
     AND NOT (OLD.meta_qualified_at IS NULL AND NEW.meta_qualified_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.meta_qualified_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.ctwa_clid, c.ctwa_clid_at
    INTO v_ctwa_clid, v_ctwa_clid_at
    FROM contacts c
    WHERE c.id = NEW.contact_id;

  -- Organic: no click, nothing to enqueue (048 design.md D2).
  IF v_ctwa_clid IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT a.meta_dataset_id, a.meta_event_name
    INTO v_dataset_id, v_event_name
    FROM accounts a
    WHERE a.id = NEW.account_id;

  v_status := CASE WHEN v_dataset_id IS NULL THEN 'unconfigured' ELSE 'pending' END;

  BEGIN
    INSERT INTO meta_capi_events (
      account_id, deal_id, contact_id,
      event_name, event_time,
      ctwa_clid, ctwa_clid_at, status
    ) VALUES (
      NEW.account_id, NEW.id, NEW.contact_id,
      v_event_name, now(),
      v_ctwa_clid, v_ctwa_clid_at, v_status
    )
    -- Revive a canceled row rather than letting the unique index
    -- swallow the insert, which would make the first unmark permanent
    -- and the card's toggle a one-way door (design.md D5). The WHERE
    -- leaves every other state alone: re-marking a deal whose
    -- conversion was already sent changes nothing. attempts /
    -- next_attempt_at / last_error reset so a row canceled while
    -- carrying a stale error restarts clean once delivery exists.
    ON CONFLICT (deal_id, event_name) DO UPDATE SET
      status          = EXCLUDED.status,
      event_time      = EXCLUDED.event_time,
      contact_id      = EXCLUDED.contact_id,
      ctwa_clid       = EXCLUDED.ctwa_clid,
      ctwa_clid_at    = EXCLUDED.ctwa_clid_at,
      attempts        = 0,
      next_attempt_at = now(),
      last_error      = NULL
    WHERE meta_capi_events.status = 'canceled';
  EXCEPTION WHEN OTHERS THEN
    -- An outbox bug must never cost the clinic a deal write
    -- (048 design.md D11). Log and let the write through.
    RAISE WARNING 'meta_capi_enqueue: failed to enqueue for deal %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION meta_capi_enqueue() IS
  'Fires on deals.meta_qualified_at, never on deals.status (migration 049): a conversion is reported because an operator decided to report it, not because the clinic qualified the lead. SECURITY DEFINER: runs as authenticated for every browser writer, and migration 046 revoked SELECT ON accounts from that role. Never raises past its own statements; a failure here must not abort the caller''s deal write.';

-- ============================================================
-- 4. Triggers — the status-keyed one is gone (design.md D3)
-- ============================================================
DROP TRIGGER IF EXISTS meta_capi_enqueue_upd ON deals;
CREATE TRIGGER meta_capi_enqueue_upd
  AFTER UPDATE OF meta_qualified_at ON deals
  FOR EACH ROW EXECUTE FUNCTION meta_capi_enqueue();

-- AFTER INSERT, never BEFORE INSERT: meta_capi_events.deal_id
-- references deals(id); in a BEFORE INSERT trigger that row does not
-- exist yet, the foreign key check fails, and the deal insert itself
-- aborts. Unchanged from 048 apart from what the function does.
DROP TRIGGER IF EXISTS meta_capi_enqueue_ins ON deals;
CREATE TRIGGER meta_capi_enqueue_ins
  AFTER INSERT ON deals
  FOR EACH ROW EXECUTE FUNCTION meta_capi_enqueue();

-- ============================================================
-- 5. Cancel what the old rule enqueued (design.md D6)
--
-- `pending` is the only state that would actually ship. unconfigured
-- rows are left alone: they were never going to be delivered and they
-- are the count that justifies configuring an account.
--
-- Bounded by `meta_qualified_at IS NULL` so this file stays re-runnable
-- after the feature is live — a pending row whose deal IS marked came
-- from an operator's decision and must survive a re-run. An operator
-- who does want one of the canceled ones reported simply marks that
-- deal on the card: the ON CONFLICT above revives exactly that row.
-- ============================================================
UPDATE meta_capi_events e
   SET status = 'canceled'
  FROM deals d
 WHERE d.id = e.deal_id
   AND e.status = 'pending'
   AND d.meta_qualified_at IS NULL;
