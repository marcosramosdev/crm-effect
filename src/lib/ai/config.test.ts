import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock("@/lib/whatsapp/encryption", () => ({
  decrypt: (v: string) => `plain:${v}`,
}));

import { loadAiConfig, loadEmbeddingsKey } from "./config";

function dbReturning(row: Record<string, unknown> | null): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return chain as unknown as SupabaseClient;
}

const ROW = {
  provider: "openai",
  model: "gpt-x",
  api_key: "enc-key",
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  followup_style: "direct",
  handoff_agent_id: null,
  embeddings_api_key: null,
};

const ENV_KEYS = [
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_API_KEY",
  "AI_EMBEDDINGS_API_KEY",
] as const;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(clearEnv);
afterEach(clearEnv);

describe("loadAiConfig", () => {
  it("resolves env-only credentials with no row (account defaults)", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-x";
    process.env.AI_API_KEY = "env-key";

    const config = await loadAiConfig(dbReturning(null), "acct");
    expect(config).toEqual({
      provider: "anthropic",
      model: "claude-x",
      apiKey: "env-key",
      systemPrompt: null,
      isActive: true,
      autoReplyEnabled: false,
      autoReplyMaxPerConversation: 3,
      followupStyle: "friendly",
      handoffAgentId: null,
      embeddingsApiKey: null,
    });
  });

  it("env credentials win over a stored key", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_MODEL = "claude-x";
    process.env.AI_API_KEY = "env-key";

    const config = await loadAiConfig(dbReturning(ROW), "acct");
    expect(config!.provider).toBe("anthropic");
    expect(config!.model).toBe("claude-x");
    expect(config!.apiKey).toBe("env-key");
    // Account-level fields still come from the row.
    expect(config!.followupStyle).toBe("direct");
  });

  it("falls back to the stored key when there is no env credential", async () => {
    const config = await loadAiConfig(dbReturning(ROW), "acct");
    expect(config).not.toBeNull();
    expect(config!.provider).toBe("openai");
    expect(config!.apiKey).toBe("plain:enc-key");
  });

  it("returns null when neither source supplies a key", async () => {
    expect(await loadAiConfig(dbReturning(null), "acct")).toBeNull();
  });

  it("returns a config for an is_active:false row (drafts off, not unavailable)", async () => {
    const config = await loadAiConfig(dbReturning(ROW), "acct");
    expect(config).not.toBeNull();
    expect(config!.isActive).toBe(false);
  });
});

describe("loadEmbeddingsKey", () => {
  it("prefers the env key over a stored one", async () => {
    process.env.AI_EMBEDDINGS_API_KEY = "env-embed";
    const result = await loadEmbeddingsKey(
      dbReturning({ embeddings_api_key: "enc-embed" }),
      "acct",
    );
    expect(result).toEqual({ key: "env-embed", corrupt: false });
  });

  it("never attempts to decrypt the stored key when an env key is present", async () => {
    process.env.AI_EMBEDDINGS_API_KEY = "env-embed";
    const result = await loadEmbeddingsKey(
      dbReturning({ embeddings_api_key: "whatever-is-stored" }),
      "acct",
    );
    expect(result).toEqual({ key: "env-embed", corrupt: false });
  });

  it("reports no key anywhere as { key: null, corrupt: false }", async () => {
    const result = await loadEmbeddingsKey(
      dbReturning({ embeddings_api_key: null }),
      "acct",
    );
    expect(result).toEqual({ key: null, corrupt: false });
  });
});
