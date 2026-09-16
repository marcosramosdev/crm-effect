import { NextResponse } from "next/server";
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import { encrypt, decrypt } from "@/lib/whatsapp/encryption";
import { validateAiCredentials } from "@/lib/ai/validate";
import { embedTexts } from "@/lib/ai/embeddings";
import { aiEnvCredentials } from "@/lib/ai/defaults";
import { AiError, type AiProvider, type FollowupStyle } from "@/lib/ai/types";

const ALLOWED_STYLES: readonly FollowupStyle[] = [
  "friendly",
  "direct",
  "consultative",
  "slot_reminder",
];

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * GET /api/ai/config
 *
 * Any member may read the config so the inbox/settings can reflect
 * whether AI is set up. When the deployment environment owns the
 * credentials (`aiEnvCredentials()`), the response omits `has_key`,
 * `has_embeddings_key`, `provider` and `model` entirely — there is
 * nothing account-level to render a credential block from. The
 * encrypted key itself is NEVER returned in either case.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from("ai_configs")
      // `api_key` is selected only to derive `has_key` — it is stripped
      // out below and never returned to the client.
      .select(
        "provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, followup_style, handoff_agent_id, api_key, embeddings_api_key",
      )
      .eq("account_id", accountId)
      .maybeSingle();

    if (error) {
      console.error("[ai/config GET] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load AI configuration" },
        { status: 500 },
      );
    }

    const envOwned = aiEnvCredentials() !== null;

    if (!data) {
      return NextResponse.json({
        configured: envOwned,
        followup_style: "friendly",
      });
    }

    const {
      api_key,
      embeddings_api_key,
      provider,
      model,
      ...rest
    } = data;

    return NextResponse.json({
      configured: true,
      ...rest,
      ...(envOwned
        ? {}
        : {
            has_key: !!api_key,
            has_embeddings_key: !!embeddings_api_key,
            provider,
            model,
          }),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/ai/config  (admin+)
 *
 * Upsert the account's AI config. Branches on `aiEnvCredentials()`:
 *
 * - the deployment owns credentials → any `api_key` / `embeddings_api_key`
 *   / `provider` / `model` in the body are ignored, no provider round-trip
 *   is spent validating them, and a fresh row is inserted with
 *   `api_key: null`.
 * - otherwise → today's behaviour: validates the key with the provider
 *   before persisting (mirrors the WhatsApp config verifying with Meta
 *   first), then stores it AES-256-GCM-encrypted. When `api_key` is
 *   omitted the existing stored key is reused (the form sends it only
 *   when the user re-enters it).
 *
 * `followup_style` is always accepted and persisted; a value outside the
 * four canonical styles is rejected with 400.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("admin");

    const limit = checkRateLimit(
      `ai-config:${userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return bad("Invalid request body");

    const systemPrompt =
      typeof body.system_prompt === "string" && body.system_prompt.trim()
        ? body.system_prompt.trim()
        : null;
    const isActive = body.is_active === true;
    const autoReplyEnabled = body.auto_reply_enabled === true;

    let maxPer = Number(body.auto_reply_max_per_conversation);
    if (!Number.isFinite(maxPer)) maxPer = 3;
    maxPer = Math.min(20, Math.max(1, Math.floor(maxPer)));

    let followupStyle: FollowupStyle | undefined;
    if ("followup_style" in body) {
      if (!ALLOWED_STYLES.includes(body.followup_style)) {
        return bad(
          'followup_style must be one of "friendly", "direct", "consultative", "slot_reminder"',
        );
      }
      followupStyle = body.followup_style;
    }

    // Handoff routing target for auto-reply. A non-empty string must be a
    // member of this account (else the conversation would be assigned to a
    // stranger); an empty string / null means "leave unassigned" (the
    // shared queue). Absent → left unchanged on update below.
    const rawHandoff =
      typeof body.handoff_agent_id === "string"
        ? body.handoff_agent_id.trim()
        : "";
    const handoffProvided = "handoff_agent_id" in body;
    let handoffAgentId: string | null = null;
    if (rawHandoff) {
      const { data: member } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("account_id", accountId)
        .eq("user_id", rawHandoff)
        .maybeSingle();
      if (!member)
        return bad("handoff_agent_id must be a member of this account");
      handoffAgentId = rawHandoff;
    }

    const { data: existing } = await supabase
      .from("ai_configs")
      .select("id, provider, model, api_key")
      .eq("account_id", accountId)
      .maybeSingle();

    const shared: Record<string, unknown> = {
      system_prompt: systemPrompt,
      is_active: isActive,
      auto_reply_enabled: autoReplyEnabled,
      auto_reply_max_per_conversation: maxPer,
    };
    if (handoffProvided) shared.handoff_agent_id = handoffAgentId;
    if (followupStyle) shared.followup_style = followupStyle;

    // Deployment owns the credentials: nothing provider/model/key-shaped
    // from the body is read, validated, or stored. The account's own
    // credential columns (if any, from before this deployment set env
    // vars) are left untouched as a dormant fallback rather than wiped.
    if (aiEnvCredentials()) {
      if (existing) {
        const { error: upErr } = await supabase
          .from("ai_configs")
          .update(shared)
          .eq("account_id", accountId);
        if (upErr) {
          console.error("[ai/config POST] update error:", upErr);
          return NextResponse.json(
            { error: "Failed to save AI configuration" },
            { status: 500 },
          );
        }
      } else {
        const { error: insErr } = await supabase.from("ai_configs").insert({
          account_id: accountId,
          created_by: userId,
          api_key: null,
          ...shared,
        });
        if (insErr) {
          console.error("[ai/config POST] insert error:", insErr);
          return NextResponse.json(
            { error: "Failed to save AI configuration" },
            { status: 500 },
          );
        }
      }
      return NextResponse.json({ success: true });
    }

    // --- Account-owned credentials: unchanged path. ---

    const provider = body.provider as AiProvider;
    if (provider !== "openai" && provider !== "anthropic") {
      return bad('provider must be "openai" or "anthropic"');
    }
    const model = typeof body.model === "string" ? body.model.trim() : "";
    if (!model) return bad("model is required");

    const rawKey = typeof body.api_key === "string" ? body.api_key.trim() : "";

    // Embeddings key (optional, for semantic KB search): a non-empty
    // string sets/replaces it; an explicit null clears it; absent leaves
    // it unchanged. The form only sends it when the admin edits it.
    const rawEmbeddingsKey =
      typeof body.embeddings_api_key === "string"
        ? body.embeddings_api_key.trim()
        : "";
    const clearEmbeddingsKey = body.embeddings_api_key === null;

    let apiKeyPlain: string;
    if (rawKey) {
      apiKeyPlain = rawKey;
    } else if (existing?.api_key) {
      try {
        apiKeyPlain = decrypt(existing.api_key);
      } catch {
        return bad(
          "Stored API key could not be decrypted — re-enter your key.",
        );
      }
    } else {
      return bad("api_key is required");
    }

    // Only spend a provider round-trip when the credentials that affect
    // reachability actually changed. A save that just flips a toggle or
    // edits the system prompt on an existing, already-validated config
    // skips the call — no wasted token/latency on the account's key.
    const credentialsChanged =
      !existing ||
      rawKey !== "" ||
      provider !== existing.provider ||
      model !== existing.model;

    if (credentialsChanged) {
      try {
        await validateAiCredentials({
          provider,
          model,
          apiKey: apiKeyPlain,
          systemPrompt,
          isActive,
          autoReplyEnabled,
          autoReplyMaxPerConversation: maxPer,
          followupStyle: followupStyle ?? "friendly",
          handoffAgentId: null,
          embeddingsApiKey: null,
        });
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: err.message, code: err.code },
            { status: 400 },
          );
        }
        console.error("[ai/config POST] validation error:", err);
        return bad("Could not validate the API key with the provider.");
      }
    }

    // Validate a new embeddings key before storing (a cheap 1-input
    // embed), same "verify before save" discipline as the chat key.
    if (rawEmbeddingsKey) {
      try {
        await embedTexts(rawEmbeddingsKey, ["ping"]);
      } catch (err) {
        if (err instanceof AiError) {
          return NextResponse.json(
            { error: `Embeddings key: ${err.message}`, code: err.code },
            { status: 400 },
          );
        }
        console.error("[ai/config POST] embeddings validation error:", err);
        return bad("Could not validate the embeddings key.");
      }
    }

    const encryptedKey = rawKey ? encrypt(rawKey) : null;
    shared.provider = provider;
    shared.model = model;
    if (rawEmbeddingsKey) {
      shared.embeddings_api_key = encrypt(rawEmbeddingsKey);
    } else if (clearEmbeddingsKey) {
      shared.embeddings_api_key = null;
    }

    if (existing) {
      const { error: upErr } = await supabase
        .from("ai_configs")
        .update(encryptedKey ? { ...shared, api_key: encryptedKey } : shared)
        .eq("account_id", accountId);
      if (upErr) {
        console.error("[ai/config POST] update error:", upErr);
        return NextResponse.json(
          { error: "Failed to save AI configuration" },
          { status: 500 },
        );
      }
    } else {
      const { error: insErr } = await supabase.from("ai_configs").insert({
        account_id: accountId,
        created_by: userId,
        api_key: encryptedKey, // guaranteed non-null: rawKey required when no existing row
        ...shared,
      });
      if (insErr) {
        console.error("[ai/config POST] insert error:", insErr);
        return NextResponse.json(
          { error: "Failed to save AI configuration" },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/ai/config  (admin+)
 *
 * Removes the account's AI config (turns everything off and forgets the
 * key). Also used to recover from a corrupted encrypted key.
 */
export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole("admin");
    const { error } = await supabase
      .from("ai_configs")
      .delete()
      .eq("account_id", accountId);
    if (error) {
      console.error("[ai/config DELETE] error:", error);
      return NextResponse.json(
        { error: "Failed to delete AI configuration" },
        { status: 500 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
