import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { expireFollowups, materializeFollowups } from "@/lib/followups/materialize";

/**
 * Follow-up preparation tick — design.md D2/D3.
 *
 * `GET /api/followups/cron`, same `timingSafeEqual` secret check and
 * the same `AUTOMATION_CRON_SECRET` as `/api/flows/cron`. Runs the
 * two passes and nothing else: materialise the pending rows that are
 * now due, then expire the pending/approved rows whose appointment
 * has passed. Never calls the WhatsApp gateway — `materializeFollowups`
 * / `expireFollowups` import nothing from `src/lib/whatsapp/`.
 *
 * Records the tick's timestamp on success so the pending-approval
 * queue can show when preparation last ran (design.md Risks).
 *
 * Hosting: driven by `pg_cron`+`pg_net` (migration 047) when
 * available, or an external pinger otherwise — see design.md D3.
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }

  const supplied = request.headers.get("x-cron-secret") ?? "";
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { created } = await materializeFollowups(admin);
  const { expired } = await expireFollowups(admin);

  const { error: tickErr } = await admin
    .from("followup_cron_state")
    .update({ last_tick_at: new Date().toISOString() })
    .eq("id", true);
  if (tickErr) {
    console.error("[followups-cron] failed to record last tick:", tickErr.message);
  }

  return NextResponse.json({ created, expired });
}
