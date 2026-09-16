## 1. Migration (written by the agent, applied by the operator)

- [x] 1.1 Write `supabase/migrations/045_centralized_ai_config.sql`, idempotent
      like `033_ai_reply_polish.sql`: `ALTER TABLE ai_configs ALTER COLUMN
      api_key DROP NOT NULL`, same for `provider` and `model`; add
      `followup_style text NOT NULL DEFAULT 'friendly'` with
      `CHECK (followup_style IN ('friendly','direct','consultative','slot_reminder'))`
      added separately and guarded so a re-run does not fail; set the
      `is_active` column default to `true`; `UPDATE ai_configs SET is_active =
      true WHERE is_active = false`. Header comment records that `is_active`
      now means "suggests drafts" and why the backfill is safe. Verify by
      reading the file back: every statement is `IF NOT EXISTS`-guarded or
      idempotent on a second run.
- [x] 1.2 **STOP — hard gate.** Hand the migration to the operator and wait.
      The agent does NOT run `supabase db push`, `psql`, or any equivalent.
      Resume only when the operator confirms the migration is applied. Every
      task below assumes the new schema is live.

## 2. Credential resolution

- [x] 2.1 Add `aiEnvCredentials()` to `src/lib/ai/defaults.ts`: returns
      `{ provider, model, apiKey }` only when `AI_PROVIDER` (one of `openai` /
      `anthropic`), `AI_MODEL` and `AI_API_KEY` are all set, else `null`, with a
      single `console.warn` on a partial set. Add `aiEnvEmbeddingsKey()`
      returning `AI_EMBEDDINGS_API_KEY`, falling back to `AI_API_KEY` when
      `AI_PROVIDER` is `openai`, else `null`. Verify with cases in
      `src/lib/ai/defaults.test.ts` (create it): full set resolves, partial set
      resolves to null, unknown provider resolves to null, embeddings fallback
      applies only for openai.
- [x] 2.2 Rewrite `loadAiConfig` in `src/lib/ai/config.ts`: drop the
      `requireActive` option and the `is_active` bail; resolve provider/model/key
      from `aiEnvCredentials()` when present, else from the row; return a config
      built on account defaults (persona null, drafts on, auto-reply off,
      style `friendly`) when there is no row but env credentials exist; return
      `null` only when no key resolves from either source. Add `followupStyle`
      to the select list and to the returned object. Verify by extending
      `src/lib/ai/config.test.ts`: env-only account with no row, env overriding a
      stored key, stored key with no env, neither → null, and an `is_active:
      false` row still returning a config.
- [x] 2.3 Make `loadEmbeddingsKey` resolve `aiEnvEmbeddingsKey()` first and only
      then the stored column, keeping `corrupt` meaningful for the stored branch
      only. Verify in `src/lib/ai/config.test.ts`: env key wins over a stored
      one, a corrupt stored key with an env key present reports
      `corrupt: false`, and no key anywhere reports `{ key: null, corrupt: false }`.
- [x] 2.4 Update `AiConfig` in `src/lib/ai/types.ts`: add
      `followupStyle: FollowupStyle` and export
      `type FollowupStyle = "friendly" | "direct" | "consultative" | "slot_reminder"`.
      Verify `npm run typecheck` now fails only at the call sites groups 3–5
      fix.

## 3. Switch independence

- [x] 3.1 In `src/app/api/ai/draft/route.ts`, refuse when `!config.isActive`
      with the same "not configured" response shape it uses today for a null
      config. Verify by reading the route: no other behaviour changed.
- [x] 3.2 In `src/lib/ai/auto-reply.ts`, keep the existing
      `!config.autoReplyEnabled` bail and confirm it no longer depends on
      `loadAiConfig` having filtered on `is_active`. Verify by extending
      `src/lib/ai/auto-reply.test.ts` with a case where `is_active` is false and
      `auto_reply_enabled` is true: the bot still replies.
- [x] 3.3 Drop the `requireActive: false` argument in
      `src/app/api/ai/playground/route.ts` and update its comment. Verify
      `npm run typecheck` passes for this file.

## 4. Style and the advertising guardrail

- [x] 4.1 Add `FOLLOWUP_STYLE_CLAUSES: Record<FollowupStyle, string>` and
      `MEDICAL_ADVERTISING_CLAUSE` to `src/lib/ai/defaults.ts`. The guardrail
      forbids promising or implying a result or cure, sensationalist/superlative
      claims, before-and-after comparisons and testimonials, presenting
      equipment or technique as a guarantee, and inducing self-diagnosis or
      self-medication. Verify by reading the file: both are module constants,
      not built from any account value.
- [x] 4.2 Extend `buildSystemPrompt` with a required `style` argument and push
      the style clause and the guardrail into the fixed scaffold, before the
      account's `system_prompt` part. Verify in `src/lib/ai/defaults` tests: the
      prompt for each of the four styles contains that style's clause and the
      guardrail, and an account prompt saying "promise results" does not remove
      either clause.
- [x] 4.3 Pass `config.followupStyle` at every `buildSystemPrompt` call site
      (`src/lib/ai/auto-reply.ts`, `src/app/api/ai/draft/route.ts`,
      `src/app/api/ai/playground/route.ts`). Verify `npm run typecheck` passes
      and `npm run test` is green in `src/lib/ai/`.

## 5. Config API

- [x] 5.1 In `src/app/api/ai/config/route.ts` POST: branch on
      `aiEnvCredentials()`. When env owns credentials, ignore `api_key` and
      `embeddings_api_key` from the body, skip `validateAiCredentials` and the
      embeddings ping, do not require `provider` / `model`, and insert with
      `api_key: null`. When it does not, keep today's path unchanged. Accept and
      persist `followup_style`, rejecting a value outside the four with a 400.
      Verify by hand against a running app: saving with no key set returns 200
      and writes the row; saving an unknown style returns 400.
- [x] 5.2 In the same file's GET, return `has_key`, `has_embeddings_key`,
      `provider` and `model` only when credentials are account-owned, and always
      return `followup_style`. Verify the response body of `GET /api/ai/config`
      on a deployment with the env vars set contains no provider, model, or key
      field.
- [x] 5.3 Delete `src/app/api/ai/test/route.ts`. Verify `grep -rn "api/ai/test"
      src/` returns nothing after task 6.1.

## 6. The `/agents` screen

- [x] 6.1 Rewrite `src/components/settings/ai-config.tsx`: remove the provider
      select, the model input, the API key input, the embeddings key input, the
      "test connection" call and their state; add a communication-style select
      bound to `followup_style`; relabel the two switches to "suggests drafts"
      (default on) and "replies automatically" (default off) and remove the
      `disabled={!isActive}` coupling between them. Keep the persona textarea,
      the knowledge base section, the handoff target and the auto-reply cap.
      Verify in the running app: the form saves and reloads persona, style and
      both switches, and offers no credential field.
- [x] 6.2 Reduce `src/app/(dashboard)/agents/page.tsx` to the header plus
      `<AiConfig />` — no tabs, no landing-tab fetch, no imports of
      `AiPlayground` / `AiUsageCard`. Verify `/agents` renders one page with no
      tab strip and `npm run lint` reports no unused import.

## 7. Feature gating

- [x] 7.1 Remove `/agents` from `GATED_FEATURE_PREFIXES` in
      `src/lib/feature-flags.ts` and update both doc comments to name only
      Broadcasts, Automations and Flows. Verify with a unit assertion or a read:
      `isGatedFeaturePath("/agents")` is false and `isGatedFeaturePath("/flows/x")`
      is true.
- [x] 7.2 Move the AI Agents entry out of the gated branch in
      `src/components/layout/sidebar.tsx` and out of any gated title handling in
      `src/components/layout/header.tsx`. Verify in the running app with the
      switch unset: the sidebar shows AI Agents and no Broadcasts / Automations
      / Flows, and `/agents` renders while `/broadcasts` redirects to
      `/dashboard`.
- [x] 7.3 Confirm `src/middleware.ts` still matches `/agents` for auth but no
      longer redirects it. Verify by signing out and hitting `/agents`: the
      response is the login redirect, not the dashboard redirect.

## 8. Copy and docs

- [x] 8.1 Update the AI namespace in `messages/en.json`, `messages/pt-BR.json`
      and `messages/ko.json`: remove the provider / model / key / test-connection
      keys, add the four style labels (pt-BR: Amigável, Direto, Consultivo,
      Lembrete de vaga) and the new switch labels and descriptions. Verify
      `npm run build` passes with no missing-message warning and the screen shows
      no raw key names in any locale.
- [x] 8.2 Rewrite the "AI reply assistant" block in `.env.local.example`:
      document `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY` as the Effect-owned
      credentials and `AI_EMBEDDINGS_API_KEY` as optional, state that a
      per-account key is only a fallback when none of them is set, and keep
      `AI_REQUEST_TIMEOUT_MS` / `AI_CONTEXT_MESSAGE_LIMIT`. Also drop "AI
      Agents" from the `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED` block. Verify by
      reading the file back: no "bring-your-own-key" wording remains.

## 9. Verification

- [x] 9.1 Run `npm run typecheck`, `npm run lint` and `npm run test` — all
      green, with the AI suites covering env-first resolution, switch
      independence and the prompt clauses.
- [x] 9.2 End-to-end on a running app with the env vars set and
      `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED` unset: an account whose
      `ai_configs.api_key` is null gets a working draft in the inbox; `/agents`
      loads and saves; `/broadcasts` still redirects to `/dashboard`; a
      knowledge-base entry saves and is retrieved in a later draft.
