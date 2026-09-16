import { describe, expect, it, vi, beforeEach } from "vitest";
import type { AiConfig } from "@/lib/ai/types";

const h = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateReply: vi.fn(),
  logAiUsage: vi.fn(),
}));

vi.mock("@/lib/auth/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/account")>();
  return { ...actual, requireRole: h.requireRole };
});
vi.mock("@/lib/ai/config", () => ({ loadAiConfig: h.loadAiConfig }));
vi.mock("@/lib/ai/context", () => ({
  buildConversationContext: h.buildConversationContext,
}));
vi.mock("@/lib/ai/knowledge", () => ({ retrieveKnowledge: h.retrieveKnowledge }));
vi.mock("@/lib/ai/generate", () => ({ generateReply: h.generateReply }));
vi.mock("@/lib/ai/usage", () => ({ logAiUsage: h.logAiUsage }));
vi.mock("@/lib/ai/admin-client", () => ({ supabaseAdmin: () => ({}) }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("https://example.com/api/ai/draft", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function fakeSupabase(conversationExists = true) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: conversationExists ? { id: "conv-1" } : null,
              error: null,
            }),
        }),
      }),
    }),
  };
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: "openai",
    model: "gpt-test",
    apiKey: "sk-test",
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: false,
    autoReplyMaxPerConversation: 3,
    followupStyle: "friendly",
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...overrides,
  };
}

beforeEach(() => {
  h.requireRole.mockImplementation(async () => ({
    supabase: fakeSupabase(),
    accountId: "acct-1",
    userId: "user-1",
  }));
  h.loadAiConfig.mockResolvedValue(aiConfig());
  h.buildConversationContext.mockResolvedValue([
    { role: "user", content: "Oi, ainda quero agendar" },
  ]);
  h.retrieveKnowledge.mockResolvedValue([]);
  h.generateReply.mockResolvedValue({ text: "draft text", usage: null });
  h.logAiUsage.mockResolvedValue(undefined);
});

describe("POST /api/ai/draft — mode", () => {
  it("defaults to draft mode and rejects an unknown mode", async () => {
    const res = await POST(req({ conversation_id: "conv-1", mode: "bogus" }));
    expect(res.status).toBe(400);
  });

  it("accepts mode: followup and frames the prompt as a reconnect", async () => {
    const res = await POST(req({ conversation_id: "conv-1", mode: "followup" }));
    expect(res.status).toBe(200);
    const [{ systemPrompt }] = h.generateReply.mock.calls[0];
    expect(systemPrompt).toContain("gone quiet");
  });
});

describe("POST /api/ai/draft — style override", () => {
  it("a per-request style reaches generation without changing the account default", async () => {
    const res1 = await POST(
      req({ conversation_id: "conv-1", mode: "followup", style: "direct" }),
    );
    expect(res1.status).toBe(200);
    const [{ systemPrompt: firstPrompt }] = h.generateReply.mock.calls[0];
    expect(firstPrompt).toContain("Communication style: direct.");

    // A second call with no override reads straight back off the
    // (unmocked, therefore unchanged) account default — friendly.
    h.generateReply.mockClear();
    const res2 = await POST(req({ conversation_id: "conv-1", mode: "followup" }));
    expect(res2.status).toBe(200);
    const [{ systemPrompt: secondPrompt }] = h.generateReply.mock.calls[0];
    expect(secondPrompt).toContain("Communication style: friendly.");
  });

  it("rejects an unknown style", async () => {
    const res = await POST(
      req({ conversation_id: "conv-1", style: "bogus-style" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/ai/draft — empty conversation", () => {
  it("returns 422 instead of generating", async () => {
    h.buildConversationContext.mockResolvedValue([]);
    const res = await POST(req({ conversation_id: "conv-1" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe("no_messages");
    expect(h.generateReply).not.toHaveBeenCalled();
  });
});
