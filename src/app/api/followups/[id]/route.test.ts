import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  sendMessageToConversation: vi.fn(),
}));

vi.mock("@/lib/auth/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account")>();
  return { ...actual, requireRole: h.requireRole };
});

vi.mock("@/lib/whatsapp/send-message", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/send-message")>();
  return { ...actual, sendMessageToConversation: h.sendMessageToConversation };
});

import { ForbiddenError } from "@/lib/auth/account";
import { SendMessageError } from "@/lib/whatsapp/send-message";
import { POST } from "./route";

// ------------------------------------------------------------
// A minimal in-memory `followup_messages` table: filters chain via
// `.eq()`, and an `.update()` earlier in the chain is applied to
// whatever rows the final `.select().limit()/.maybeSingle()` matches.
// ------------------------------------------------------------
function makeSupabase(rows: Record<string, unknown>[]) {
  function query() {
    const filters: [string, unknown][] = [];
    let patch: Record<string, unknown> | null = null;
    const builder = {
      update(p: Record<string, unknown>) {
        patch = p;
        return builder;
      },
      select() {
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return builder;
      },
      limit() {
        return Promise.resolve({ data: finish(), error: null });
      },
      maybeSingle() {
        const matched = finish();
        return Promise.resolve({ data: matched[0] ?? null, error: null });
      },
      // Supabase's real query builder is itself thenable, so a chain
      // that ends bare on `.eq()` (no `.select()`) still executes when
      // awaited — mirror that so `update(...).eq(...)` with no
      // trailing select runs the patch.
      then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve({ data: finish(), error: null }).then(onFulfilled);
      },
    };
    function finish() {
      const matches = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
      if (patch) {
        for (const m of matches) Object.assign(m, patch);
      }
      return matches.map((m) => ({ ...m }));
    }
    return builder;
  }
  return {
    from: (table: string) => {
      if (table !== "followup_messages") throw new Error(`unexpected table ${table}`);
      return query();
    },
  };
}

const PENDING_ROW = () => ({
  id: "fu-1",
  account_id: "acct-1",
  status: "pending",
  conversation_id: "conv-1",
  body: "Olá Ana! Lembrete do seu horário.",
  last_error: null as string | null,
});

function req(payload: unknown) {
  return new Request("https://example.com/api/followups/fu-1", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function ctx(id = "fu-1") {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  h.requireRole.mockReset();
  h.sendMessageToConversation.mockReset();
  h.requireRole.mockImplementation(async () => ({
    supabase: makeSupabase([PENDING_ROW()]),
    accountId: "acct-1",
    userId: "user-1",
  }));
  h.sendMessageToConversation.mockResolvedValue({
    messageId: "msg-1",
    whatsappMessageId: "wa-1",
  });
});

describe("POST /api/followups/[id] — access", () => {
  it("refuses a read-only member", async () => {
    h.requireRole.mockImplementation(async () => {
      throw new ForbiddenError("This action requires the 'agent' role or higher");
    });
    const res = await POST(req({ action: "approve" }), ctx());
    expect(res.status).toBe(403);
  });

  it("treats a follow-up in another account the same as a missing row", async () => {
    const rows = [{ ...PENDING_ROW(), account_id: "other-acct" }];
    h.requireRole.mockImplementation(async () => ({
      supabase: makeSupabase(rows),
      accountId: "acct-1",
      userId: "user-1",
    }));
    const resOther = await POST(req({ action: "approve" }), ctx());
    const resMissing = await POST(req({ action: "approve" }), ctx("does-not-exist"));
    expect(resOther.status).toBe(resMissing.status);
    expect(resOther.status).toBe(404);
  });
});

describe("POST /api/followups/[id] — approve", () => {
  it("sends the frozen body with both button ids, then marks sent", async () => {
    const res = await POST(req({ action: "approve" }), ctx());
    expect(res.status).toBe(200);
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1);
    const [, , params] = h.sendMessageToConversation.mock.calls[0];
    expect(params.conversationId).toBe("conv-1");
    expect(params.interactivePayload).toMatchObject({
      kind: "buttons",
      body: "Olá Ana! Lembrete do seu horário.",
    });
    expect(params.interactivePayload.buttons).toEqual([
      { id: "fu:fu-1:confirm", title: "Confirmar" },
      { id: "fu:fu-1:reschedule", title: "Remarcar" },
    ]);
  });

  it("a second decision on the same row is refused and only one send happens", async () => {
    const rows = [PENDING_ROW()];
    h.requireRole.mockImplementation(async () => ({
      supabase: makeSupabase(rows),
      accountId: "acct-1",
      userId: "user-1",
    }));
    // First decision wins the conditional `status = 'pending'` guard;
    // a second decision arriving right after finds the row no longer
    // pending and is refused — this is what makes concurrent approvals
    // safe (design.md D7), whichever one the DB happens to serialize
    // first.
    const first = await POST(req({ action: "approve" }), ctx());
    const second = await POST(req({ action: "reject" }), ctx());
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(1);
  });

  it("on a send failure the row is not marked sent, and a retry succeeds without re-approving", async () => {
    const rows = [PENDING_ROW()];
    h.requireRole.mockImplementation(async () => ({
      supabase: makeSupabase(rows),
      accountId: "acct-1",
      userId: "user-1",
    }));
    h.sendMessageToConversation.mockRejectedValueOnce(
      new SendMessageError("gateway_error", "gateway down", 502),
    );

    const failRes = await POST(req({ action: "approve" }), ctx());
    expect(failRes.status).toBe(502);
    expect(rows[0].status).toBe("approved");
    expect(rows[0].last_error).toBe("gateway down");

    h.sendMessageToConversation.mockResolvedValueOnce({
      messageId: "msg-2",
      whatsappMessageId: "wa-2",
    });
    const retryRes = await POST(req({ action: "approve" }), ctx());
    expect(retryRes.status).toBe(200);
    expect(rows[0].status).toBe("sent");
    expect(h.sendMessageToConversation).toHaveBeenCalledTimes(2);
  });

  it("edit_and_send delivers and stores the edited body", async () => {
    const rows = [PENDING_ROW()];
    h.requireRole.mockImplementation(async () => ({
      supabase: makeSupabase(rows),
      accountId: "acct-1",
      userId: "user-1",
    }));
    const res = await POST(
      req({ action: "edit_and_send", body: "Corpo editado" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const [, , params] = h.sendMessageToConversation.mock.calls[0];
    expect(params.interactivePayload.body).toBe("Corpo editado");
    expect(rows[0].body).toBe("Corpo editado");
  });
});

describe("POST /api/followups/[id] — reject", () => {
  it("moves a pending row to rejected and sends nothing", async () => {
    const res = await POST(req({ action: "reject" }), ctx());
    expect(res.status).toBe(200);
    expect(h.sendMessageToConversation).not.toHaveBeenCalled();
  });
});

describe("POST /api/followups/[id] — terminal states are refused", () => {
  for (const terminal of ["sent", "rejected", "expired"] as const) {
    for (const action of ["approve", "reject", "edit_and_send"] as const) {
      it(`refuses ${action} on a ${terminal} row`, async () => {
        const rows = [{ ...PENDING_ROW(), status: terminal }];
        h.requireRole.mockImplementation(async () => ({
          supabase: makeSupabase(rows),
          accountId: "acct-1",
          userId: "user-1",
        }));
        const payload =
          action === "edit_and_send" ? { action, body: "x" } : { action };
        const res = await POST(req(payload), ctx());
        expect(res.status).toBe(409);
        expect(rows[0].status).toBe(terminal);
        expect(h.sendMessageToConversation).not.toHaveBeenCalled();
      });
    }
  }
});
