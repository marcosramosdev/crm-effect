import type { SupabaseClient } from "@supabase/supabase-js";

export interface MoveDealStageResult {
  ok: boolean;
  /** Present only when `ok` is false — the gateway/RLS error message. */
  error?: string;
}

/**
 * Persist a deal's pipeline stage.
 *
 * This is only the write. The caller owns the optimistic UI update and any
 * revert/refetch on failure — the pipeline board and the inbox stage
 * pickers all funnel through here so the persistence path can't drift
 * between them.
 */
export async function moveDealStage(
  db: SupabaseClient,
  dealId: string,
  stageId: string,
): Promise<MoveDealStageResult> {
  const { error } = await db
    .from("deals")
    .update({ stage_id: stageId })
    .eq("id", dealId);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Persist a small edit to a deal's own columns (inline board-card
 * editing: title, value, and/or scheduled appointment time). Like
 * `moveDealStage` this is only the write — the caller owns the
 * optimistic UI update and the revert on failure — so the board card
 * and any future inline surface share one persistence path.
 *
 * The patch type is kept deliberately narrow: the body spreads it
 * straight into `.update()`, so the TypeScript shape is the only guard
 * on what a caller can write. `scheduled_at` accepts a UTC ISO instant
 * or `null` to clear it.
 *
 * `meta_qualified_at` is the conversion mark (migration 049): a UTC ISO
 * instant marks the lead as worth reporting to Meta, `null` clears the
 * mark and cancels an undelivered conversion. Both consequences happen
 * in the database trigger — this write only moves the column.
 */
export async function updateDealInline(
  db: SupabaseClient,
  dealId: string,
  patch: {
    title?: string;
    value?: number;
    scheduled_at?: string | null;
    meta_qualified_at?: string | null;
  },
): Promise<MoveDealStageResult> {
  const { error } = await db.from("deals").update(patch).eq("id", dealId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Persist a deal's archived state (migration 043).
 *
 * `archived = true` stamps `archived_at` with the current time;
 * `archived = false` clears it back to `NULL` (active). As with
 * `moveDealStage` this is only the write — the board card, the
 * archived-deals view, and the deal detail sheet each own their
 * optimistic update and the revert on failure.
 *
 * SCOPE: archive is a board-view concern. This write only sets the
 * column; nothing here (and nothing outside the pipeline board's own
 * deal load) filters on it, so archived deals still surface in every
 * other `deals` read by design.
 */
export async function setDealArchived(
  db: SupabaseClient,
  dealId: string,
  archived: boolean,
): Promise<MoveDealStageResult> {
  const { error } = await db
    .from("deals")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", dealId);

  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Move a deal to a DIFFERENT pipeline, landing on `stageId`.
 *
 * The same deal row is reassigned (`pipeline_id` + `stage_id` in one
 * write) — its value, notes, assignee, status, and history are
 * untouched. Kept separate from `moveDealStage` so stage-only moves
 * (the common case, and the pipeline board / conversation-list row)
 * keep their exact one-column write.
 *
 * Guards against a corrupt (pipeline, stage) pair reaching the row:
 * `stageId` MUST belong to `pipelineId`. The sidebar picker only ever
 * offers the target pipeline's own stages, but this check makes the
 * write safe regardless of caller. As with `moveDealStage` this is
 * only the persistence — the caller owns the optimistic UI and any
 * revert/refetch on failure.
 */
export async function moveDealToPipeline(
  db: SupabaseClient,
  dealId: string,
  pipelineId: string,
  stageId: string,
): Promise<MoveDealStageResult> {
  const { data: stage, error: stageError } = await db
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("id", stageId)
    .single();

  if (stageError) return { ok: false, error: stageError.message };
  if (!stage || stage.pipeline_id !== pipelineId) {
    return {
      ok: false,
      error: "Selected stage does not belong to the target pipeline.",
    };
  }

  const { error } = await db
    .from("deals")
    .update({ pipeline_id: pipelineId, stage_id: stageId })
    .eq("id", dealId);

  return error ? { ok: false, error: error.message } : { ok: true };
}
