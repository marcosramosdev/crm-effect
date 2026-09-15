import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  moveDealStage,
  moveDealToPipeline,
  setDealArchived,
  updateDealInline,
} from "./deals";

function fakeDb(error: { message: string } | null) {
  const eq = vi.fn().mockResolvedValue({ error });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });
  return { db: { from } as unknown as SupabaseClient, from, update, eq };
}

/**
 * `moveDealToPipeline` reads `pipeline_stages` first, then updates
 * `deals`. `stagePipelineId` is what the stage lookup resolves to.
 */
function fakePipelineDb(opts: {
  stagePipelineId?: string;
  stageError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  const updateEq = vi
    .fn()
    .mockResolvedValue({ error: opts.updateError ?? null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  const single = vi.fn().mockResolvedValue({
    data:
      opts.stagePipelineId !== undefined
        ? { pipeline_id: opts.stagePipelineId }
        : null,
    error: opts.stageError ?? null,
  });
  const selectEq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq: selectEq });

  const from = vi.fn((table: string) =>
    table === "pipeline_stages" ? { select } : { update },
  );
  return { db: { from } as unknown as SupabaseClient, from, update, updateEq };
}

describe("moveDealStage", () => {
  it("writes stage_id for the deal and reports ok", async () => {
    const { db, from, update, eq } = fakeDb(null);

    const result = await moveDealStage(db, "deal-1", "stage-2");

    expect(from).toHaveBeenCalledWith("deals");
    expect(update).toHaveBeenCalledWith({ stage_id: "stage-2" });
    expect(eq).toHaveBeenCalledWith("id", "deal-1");
    expect(result).toEqual({ ok: true });
  });

  it("surfaces the error message when the write fails", async () => {
    const { db } = fakeDb({ message: "row-level security" });

    const result = await moveDealStage(db, "deal-1", "stage-2");

    expect(result).toEqual({ ok: false, error: "row-level security" });
  });
});

describe("updateDealInline", () => {
  it("writes the close-date patch and reports ok", async () => {
    const { db, from, update, eq } = fakeDb(null);

    const result = await updateDealInline(db, "deal-1", {
      expected_close_date: "2026-09-01",
    });

    expect(from).toHaveBeenCalledWith("deals");
    expect(update).toHaveBeenCalledWith({ expected_close_date: "2026-09-01" });
    expect(eq).toHaveBeenCalledWith("id", "deal-1");
    expect(result).toEqual({ ok: true });
  });

  it("writes null to clear the close date", async () => {
    const { db, update } = fakeDb(null);

    const result = await updateDealInline(db, "deal-1", {
      expected_close_date: null,
    });

    expect(update).toHaveBeenCalledWith({ expected_close_date: null });
    expect(result).toEqual({ ok: true });
  });
});

describe("setDealArchived", () => {
  it("stamps archived_at with an ISO timestamp when archiving", async () => {
    const { db, from, update, eq } = fakeDb(null);

    const result = await setDealArchived(db, "deal-1", true);

    expect(from).toHaveBeenCalledWith("deals");
    expect(eq).toHaveBeenCalledWith("id", "deal-1");
    const patch = update.mock.calls[0][0] as { archived_at: string | null };
    expect(typeof patch.archived_at).toBe("string");
    expect(Number.isNaN(Date.parse(patch.archived_at as string))).toBe(false);
    expect(result).toEqual({ ok: true });
  });

  it("clears archived_at to null when unarchiving", async () => {
    const { db, update } = fakeDb(null);

    const result = await setDealArchived(db, "deal-1", false);

    expect(update).toHaveBeenCalledWith({ archived_at: null });
    expect(result).toEqual({ ok: true });
  });

  it("surfaces the error message when the write fails", async () => {
    const { db } = fakeDb({ message: "row-level security" });

    const result = await setDealArchived(db, "deal-1", true);

    expect(result).toEqual({ ok: false, error: "row-level security" });
  });
});

describe("moveDealToPipeline", () => {
  it("reassigns pipeline_id + stage_id in one write when the stage belongs to the pipeline", async () => {
    const { db, from, update, updateEq } = fakePipelineDb({
      stagePipelineId: "pipe-2",
    });

    const result = await moveDealToPipeline(db, "deal-1", "pipe-2", "stage-9");

    expect(from).toHaveBeenCalledWith("pipeline_stages");
    expect(from).toHaveBeenCalledWith("deals");
    expect(update).toHaveBeenCalledWith({
      pipeline_id: "pipe-2",
      stage_id: "stage-9",
    });
    expect(updateEq).toHaveBeenCalledWith("id", "deal-1");
    expect(result).toEqual({ ok: true });
  });

  it("refuses the move and does not write when the stage is from another pipeline", async () => {
    const { db, update } = fakePipelineDb({ stagePipelineId: "pipe-OTHER" });

    const result = await moveDealToPipeline(db, "deal-1", "pipe-2", "stage-9");

    expect(update).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/target pipeline/i);
  });

  it("surfaces the stage lookup error", async () => {
    const { db, update } = fakePipelineDb({
      stageError: { message: "no rows" },
    });

    const result = await moveDealToPipeline(db, "deal-1", "pipe-2", "stage-9");

    expect(update).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: "no rows" });
  });

  it("surfaces the deal update error", async () => {
    const { db } = fakePipelineDb({
      stagePipelineId: "pipe-2",
      updateError: { message: "row-level security" },
    });

    const result = await moveDealToPipeline(db, "deal-1", "pipe-2", "stage-9");

    expect(result).toEqual({ ok: false, error: "row-level security" });
  });
});
