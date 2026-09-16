## Why

The AI assistant is finished code — providers, knowledge base, auto-reply,
handoff, playground — but it is unreachable: it sits behind the same
incomplete-features switch as Broadcasts, Automations and Flows, and even with
that switch on it refuses to work until the account pastes its own OpenAI or
Anthropic key. The product is sold installed by Effect Digital to clinics; a
doctor is never going to create a provider account and generate an API key. The
key and the model belong to Effect, set once per deployment, and the AI screen
the client sees should only ask for what a clinic actually knows: who the clinic
is, how it talks, and whether the assistant may answer on its own.

Clinics also advertise under CFM Resolution 1.974/2011, which forbids promising
results and sensationalist language. A generated message is advertising, so that
prohibition belongs in the prompt scaffold, not in a training document.

## What Changes

- AI Agents leaves the gated set. `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED`
  keeps covering Broadcasts, Automations and Flows only; `/agents` is reachable
  and appears in the navigation with the switch off.
- Provider credentials move to the server environment: `AI_PROVIDER`,
  `AI_MODEL`, `AI_API_KEY`, plus optional `AI_EMBEDDINGS_API_KEY`. When the
  environment supplies them they win; the per-account columns become a legacy
  fallback for a deployment that sets nothing.
- **BREAKING** `ai_configs.api_key` becomes nullable, and `provider` / `model`
  become nullable. A row can now exist with no key at all — the provisioning
  change writes exactly that shape.
- **BREAKING** `ai_configs.is_active` changes meaning: it is now "the assistant
  suggests drafts", defaulting to on, and it no longer gates auto-reply.
  `auto_reply_enabled` stands alone and stays off by default. Turning drafts
  off no longer silences the auto-reply bot, and vice versa.
- New column `ai_configs.followup_style` with the values `friendly`, `direct`,
  `consultative` and `slot_reminder`, defaulting to `friendly`. It is the
  account's default tone for generated messages; the follow-up change lets the
  operator swap it per send.
- The system prompt scaffold gains two fixed clauses every generation carries:
  the selected communication style, and a medical-advertising guardrail
  forbidding promised results, guarantees of cure, before/after claims and
  sensationalist language.
- `/agents` becomes one page instead of three tabs: clinic context and persona,
  default communication style, knowledge base, and the two toggles. The
  provider/model/key block disappears from the client's view; the Playground and
  Usage components stay in the repository but are no longer reachable from the
  client's navigation.
- The AI config API stops accepting and stops requiring keys when the
  environment provides them, and never reports a key value or a provider name to
  the client.

## Capabilities

### New Capabilities

- `ai-assistant`: how the AI reply assistant is configured and bounded — where
  provider credentials come from, what an account may configure, the drafts and
  auto-reply switches, the default communication style, and the content
  guardrails every generated message carries.

### Modified Capabilities

- `feature-availability`: the gated set shrinks from four features to three.
  AI Agents is no longer hidden, no longer absent from operator chrome, and
  `/agents` is no longer redirected to the dashboard.

## Impact

- Database: `supabase/migrations/045_centralized_ai_config.sql` — makes
  `ai_configs.api_key`, `provider` and `model` nullable, adds
  `followup_style` with a CHECK constraint and a `friendly` default, and
  backfills `is_active = true` on existing rows so the meaning change does not
  silently turn drafts off. **Applied manually by the operator**, not by the
  agent.
- Server config: `src/lib/ai/config.ts` (env-first resolution in `loadAiConfig`
  and `loadEmbeddingsKey`), `src/lib/ai/defaults.ts` (style clauses, medical
  guardrail, env model default), `src/lib/ai/types.ts` (`AiConfig` gains
  `followupStyle`, `provider` / `model` sourcing).
- Consumers of the config: `src/lib/ai/auto-reply.ts` (no longer reads
  `isActive`), `src/app/api/ai/draft/route.ts`, `src/app/api/ai/playground/route.ts`,
  `src/app/api/ai/knowledge/**`, `src/lib/ai/generate.ts`.
- API: `src/app/api/ai/config/route.ts` — key validation only when the account
  is the credential source; response drops `has_key` / provider details when the
  environment owns them.
- UI: `src/app/(dashboard)/agents/page.tsx` (tabs removed),
  `src/components/settings/ai-config.tsx` (credential block removed, style
  selector added, toggles relabelled), `src/components/agents/*` (kept, no longer
  linked).
- Feature gating: `src/lib/feature-flags.ts`, `src/middleware.ts`,
  `src/components/layout/sidebar.tsx`, `src/components/layout/header.tsx`, the
  dashboard quick actions.
- i18n: `messages/{en,pt-BR,ko}.json` — the AI settings namespace loses the
  credential labels and gains the style options and the new toggle copy.
- Docs: `.env.local.example` — the "bring your own key" section is replaced by
  the Effect-owned credentials; `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED` no
  longer mentions AI Agents.
- Dependencies: none added.

## Out of Scope

Per-account spend limits, per-client model choice, a step-by-step setup wizard,
and the per-send style override (owned by `followup-approval-queue`).
