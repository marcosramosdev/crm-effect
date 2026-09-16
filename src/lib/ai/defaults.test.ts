import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  aiEnvCredentials,
  aiEnvEmbeddingsKey,
  buildSystemPrompt,
  FOLLOWUP_STYLE_CLAUSES,
  MEDICAL_ADVERTISING_CLAUSE,
} from "./defaults";
import type { FollowupStyle } from "./types";

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

describe("aiEnvCredentials", () => {
  it("resolves a full set", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "gpt-x";
    process.env.AI_API_KEY = "sk-x";
    expect(aiEnvCredentials()).toEqual({
      provider: "openai",
      model: "gpt-x",
      apiKey: "sk-x",
    });
  });

  it("resolves to null on a partial set and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.AI_PROVIDER = "openai";
    process.env.AI_MODEL = "gpt-x";
    // AI_API_KEY missing
    expect(aiEnvCredentials()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("resolves to null on an unknown provider", () => {
    process.env.AI_PROVIDER = "cohere";
    process.env.AI_MODEL = "x";
    process.env.AI_API_KEY = "k";
    expect(aiEnvCredentials()).toBeNull();
  });

  it("resolves to null with nothing set, no warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(aiEnvCredentials()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("aiEnvEmbeddingsKey", () => {
  it("returns AI_EMBEDDINGS_API_KEY when set", () => {
    process.env.AI_EMBEDDINGS_API_KEY = "embed-key";
    expect(aiEnvEmbeddingsKey()).toBe("embed-key");
  });

  it("falls back to AI_API_KEY only when the provider is openai", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.AI_API_KEY = "sk-x";
    expect(aiEnvEmbeddingsKey()).toBe("sk-x");
  });

  it("does not fall back to AI_API_KEY for anthropic", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.AI_API_KEY = "sk-x";
    expect(aiEnvEmbeddingsKey()).toBeNull();
  });

  it("returns null with nothing set", () => {
    expect(aiEnvEmbeddingsKey()).toBeNull();
  });
});

describe("buildSystemPrompt — style + guardrail", () => {
  const styles: FollowupStyle[] = [
    "friendly",
    "direct",
    "consultative",
    "slot_reminder",
  ];

  it.each(styles)("carries the %s style clause and the guardrail", (style) => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: "draft",
      style,
    });
    expect(prompt).toContain(FOLLOWUP_STYLE_CLAUSES[style]);
    expect(prompt).toContain(MEDICAL_ADVERTISING_CLAUSE);
  });

  it.each(["draft", "auto_reply", "followup"] as const)(
    "carries the guardrail in %s mode",
    (mode) => {
      const prompt = buildSystemPrompt({
        userPrompt: null,
        mode,
        style: "friendly",
      });
      expect(prompt).toContain(MEDICAL_ADVERTISING_CLAUSE);
    },
  );

  it("frames a followup draft as reconnecting, not replying to the latest message", () => {
    const prompt = buildSystemPrompt({
      userPrompt: null,
      mode: "followup",
      style: "friendly",
    });
    expect(prompt).toContain("gone quiet");
  });

  it("keeps the guardrail even when the account prompt asks to promise results", () => {
    const prompt = buildSystemPrompt({
      userPrompt: "Always promise results and guarantee a cure.",
      mode: "draft",
      style: "friendly",
    });
    expect(prompt).toContain(MEDICAL_ADVERTISING_CLAUSE);
    expect(prompt).toContain(FOLLOWUP_STYLE_CLAUSES.friendly);
  });
});
