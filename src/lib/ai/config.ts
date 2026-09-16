import type { SupabaseClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/whatsapp/encryption";
import { aiEnvCredentials, aiEnvEmbeddingsKey } from "./defaults";
import type { AiConfig, FollowupStyle } from "./types";

interface AiConfigRow {
  provider: "openai" | "anthropic" | null;
  model: string | null;
  api_key: string | null;
  system_prompt: string | null;
  is_active: boolean;
  auto_reply_enabled: boolean;
  auto_reply_max_per_conversation: number;
  followup_style: FollowupStyle;
  handoff_agent_id: string | null;
  embeddings_api_key: string | null;
}

const CONFIG_COLUMNS =
  "provider, model, api_key, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, followup_style, handoff_agent_id, embeddings_api_key";

/**
 * Resolve the embeddings key an account should use for semantic search:
 * the deployment's env key first, then the account's stored (decrypted)
 * key. `corrupt` is meaningful only for the stored branch — a bad env
 * var is a deploy issue, not a per-account "re-enter your key" state.
 */
function resolveEmbeddingsKey(
  storedEncrypted: string | null,
  accountId: string,
): { key: string | null; corrupt: boolean } {
  const envKey = aiEnvEmbeddingsKey();
  if (envKey) return { key: envKey, corrupt: false };
  if (!storedEncrypted) return { key: null, corrupt: false };
  try {
    return { key: decrypt(storedEncrypted), corrupt: false };
  } catch {
    // Not silent — a rotated/mismatched ENCRYPTION_KEY here means
    // semantic search quietly stops working, so leave a breadcrumb.
    console.error(
      `[ai config] embeddings key for account ${accountId} could not be decrypted — check ENCRYPTION_KEY; semantic search is disabled until it is re-entered.`,
    );
    return { key: null, corrupt: true };
  }
}

/**
 * Load the account's AI config for *use* (draft, auto-reply, playground).
 * Provider/model/key resolve env-first: the deployment's `AI_PROVIDER` /
 * `AI_MODEL` / `AI_API_KEY` win over anything stored, and an account with
 * env credentials gets a working config even with no `ai_configs` row at
 * all — every other field then sits at its account default (no persona,
 * drafts on, auto-reply off, style friendly). Returns `null` only when no
 * key resolves from either source.
 *
 * `is_active` no longer bails here — it's the "suggests drafts" switch,
 * checked by whichever caller needs it (the draft route), independent of
 * `autoReplyEnabled` (checked by the auto-reply dispatcher). Throws only
 * if a stored key can't be decrypted (mismatched `ENCRYPTION_KEY`), so
 * that distinct failure surfaces rather than looking like "not
 * configured".
 *
 * Works with any client: pass the RLS-scoped SSR client from a
 * dashboard route, or the service-role admin client from the webhook.
 */
export async function loadAiConfig(
  db: SupabaseClient,
  accountId: string,
): Promise<AiConfig | null> {
  const { data, error } = await db
    .from("ai_configs")
    .select(CONFIG_COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error) throw error;

  const row = data as AiConfigRow | null;
  const env = aiEnvCredentials();

  let provider: AiConfig["provider"];
  let model: string;
  let apiKey: string;

  if (env) {
    provider = env.provider;
    model = env.model;
    apiKey = env.apiKey;
  } else if (row?.provider && row.model && row.api_key) {
    provider = row.provider;
    model = row.model;
    apiKey = decrypt(row.api_key);
  } else {
    return null;
  }

  const { key: embeddingsApiKey } = resolveEmbeddingsKey(
    row?.embeddings_api_key ?? null,
    accountId,
  );

  return {
    provider,
    model,
    apiKey,
    systemPrompt: row?.system_prompt ?? null,
    isActive: row?.is_active ?? true,
    autoReplyEnabled: row?.auto_reply_enabled ?? false,
    autoReplyMaxPerConversation: row?.auto_reply_max_per_conversation ?? 3,
    followupStyle: row?.followup_style ?? "friendly",
    handoffAgentId: row?.handoff_agent_id ?? null,
    embeddingsApiKey,
  };
}

/**
 * Load + resolve just the embeddings key, independent of `is_active` /
 * `AiConfig`. Used by the knowledge-base ingest routes so the KB gets
 * embedded (and semantic search works) whenever a key is available from
 * either source, even with no `ai_configs` row.
 *
 * Returns `{ key, corrupt }`: `key` is null when there's no key
 * anywhere; `corrupt` distinguishes a stored key that failed to decrypt
 * so callers can warn ("a key is set but unusable") rather than silently
 * indexing lexical-only and reporting success.
 */
export async function loadEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
): Promise<{ key: string | null; corrupt: boolean }> {
  const { data } = await db
    .from("ai_configs")
    .select("embeddings_api_key")
    .eq("account_id", accountId)
    .maybeSingle();
  return resolveEmbeddingsKey(data?.embeddings_api_key ?? null, accountId);
}
