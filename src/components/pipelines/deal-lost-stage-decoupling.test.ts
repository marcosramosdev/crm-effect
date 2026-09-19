import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// deals spec.md — "A 'Perdido' stage organises the board and does not
// carry the status": marking a deal lost (or reopening it) must never
// move its stage. `handleStatusChange` in deal-form.tsx is a client
// component handler with no pure-function seam (unlike moveDealStage in
// deals.ts, which deals.test.ts already covers for the other
// direction), and this repo has no component-render test harness
// (see account-status.ts's design note on the same constraint). This
// is a static regression check on the one write path that could
// reintroduce the coupling: it fails if a future edit adds `stage_id`
// to handleStatusChange's patch.
describe("DealForm's handleStatusChange stays decoupled from stage_id", () => {
  it("the status-change patch never references stage_id", () => {
    const source = readFileSync(join(__dirname, "deal-form.tsx"), "utf8");

    const start = source.indexOf("async function handleStatusChange");
    expect(start).toBeGreaterThan(-1);
    const nextFn = source.indexOf("\n  async function ", start + 1);
    expect(nextFn).toBeGreaterThan(start);

    const body = source.slice(start, nextFn);
    expect(body).toContain(".from(\"deals\")");
    expect(body).not.toMatch(/stage_id/);
  });
});
