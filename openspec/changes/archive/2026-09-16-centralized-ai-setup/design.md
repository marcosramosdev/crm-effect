## Context

See `proposal.md` — Why. The relevant current shape:

- `loadAiConfig(db, accountId, { requireActive })` in `src/lib/ai/config.ts` is
  the single place every surface — draft route, auto-reply dispatcher,
  playground — gets provider, model and decrypted key from. It returns `null`
  when the row is missing, when `is_active` is false, or when `api_key` is
  empty; callers treat all three as "AI is not available".
- `generateReply` reads `config.provider`, `config.model`, `config.apiKey` and
  nothing else, so whatever `loadAiConfig` returns is what runs.
- `buildSystemPrompt` in `src/lib/ai/defaults.ts` assembles a fixed scaffold and
  appends the account's `system_prompt` as "Business context and instructions".
  That file already owns the env-tunable knobs (`AI_REQUEST_TIMEOUT_MS`,
  `AI_CONTEXT_MESSAGE_LIMIT`).
- `src/lib/feature-flags.ts` exports the switch and `GATED_FEATURE_PREFIXES`;
  `src/middleware.ts` and the layout components read them.
- The knowledge base embeds with a separate per-account key and silently
  degrades to Postgres full-text search when it is absent.

## Goals / Non-Goals

**Goals:**

- One resolution point for credentials, so no surface can accidentally read a
  per-account key.
- No new table, no new module directory: this change is columns, a resolver, a
  prompt clause, and subtraction from the UI.
- A self-hosted deployment that sets no AI env vars keeps working exactly as it
  does today.

**Non-Goals:**

- Reworking generation, retrieval, handoff, or usage logging. They are correct;
  they only need a different source for the key.
- A per-send style override or a follow-up prompt — `followup-approval-queue`
  owns those. This change only stores the default and teaches the scaffold to
  honour a style.
- Removing the BYO-key columns. They stay as the fallback.

## Decisions

### Credentials resolve inside `loadAiConfig`, from a helper in `defaults.ts`

Add `aiEnvCredentials()` to `src/lib/ai/defaults.ts` — the module that already
reads `process.env` — returning `{ provider, model, apiKey } | null`, non-null
only when all three of `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` are present
and `AI_PROVIDER` is one of the two supported values. A partial set is treated
as absent and logged once, so a typo'd deployment falls back visibly rather
than half-configuring itself.

`loadAiConfig` then composes: env credentials if any, else the row's own
provider/model/decrypted key. Everything downstream — draft route, auto-reply,
playground, `generateReply` — is unchanged, because the resolved `AiConfig`
keeps its current shape.

*Alternative rejected:* resolving at each call site, or a new `src/lib/ai/env.ts`.
Both spread the "which key wins" rule across more files than the one function
that already owns it.

*Consequence:* `loadAiConfig` must no longer bail when the row is missing.
With env credentials an account can legitimately have no `ai_configs` row at
all, so a missing row yields a config with the env credentials and every
account-level field at its default (no persona, no knowledge, drafts on,
auto-reply off). It returns `null` only when no key can be resolved from either
source.

### `requireActive` goes away; each caller checks its own switch

`is_active` stops being a master switch, so a shared `requireActive` flag no
longer means anything. `loadAiConfig` drops the option and returns whatever
resolves; the draft route checks `config.isActive`, the auto-reply dispatcher
checks `config.autoReplyEnabled` (it currently relies on `loadAiConfig` having
enforced `is_active` first), and the playground checks neither — which is what
`requireActive: false` was already buying it.

*Alternative rejected:* a new `draft_enabled` column with `is_active` pinned
true. It is one more column and a backfill to express a boolean the schema
already has.

### `followup_style` is a text column with a CHECK, storing canonical values

`friendly | direct | consultative | slot_reminder`, `NOT NULL DEFAULT
'friendly'`, guarded by a CHECK constraint like `provider`'s. The stored values
are English identifiers; the Portuguese labels (Amigável, Direto, Consultivo,
Lembrete de vaga) live in `messages/*.json`, matching how every other enum-ish
value in this codebase is localized.

### Style and the CFM guardrail go into the fixed scaffold

`buildSystemPrompt` takes a `style` argument and emits two more fixed parts:
a one-paragraph style clause selected from a `FOLLOWUP_STYLE_CLAUSES` record,
and the medical-advertising prohibition. Both are pushed **before** the
account's own `system_prompt`, which keeps its current framing as business
context rather than as instructions — an admin cannot displace the guardrail by
writing "ignore the rules above" in the persona box, for the same reason a
customer message cannot.

*Alternative rejected:* validating generated output against a banned-phrase
list. It is a second, weaker check that fails on paraphrase and would have to
decide what to do with a rejected generation.

### The config API becomes credential-aware

`POST /api/ai/config` asks `aiEnvCredentials()` first:

- env owns the credentials → submitted `api_key` / `embeddings_api_key` are
  dropped, no provider round-trip is spent validating them, `provider` and
  `model` are not required in the body, and an insert writes a row with
  `api_key NULL`.
- no env credentials → today's behaviour verbatim, including
  `validateAiCredentials` before persisting.

`GET` keeps returning `configured`, but reports `has_key` and the
provider/model only in the account-owned case, so the client has nothing to
render a credential block from.

`/api/ai/test` — the "test connection" endpoint — loses its only caller when
the credential block goes, and duplicates the validation `POST` already does on
save. Delete it with the block.

### Embeddings follow the same chain, with one convenience

`loadEmbeddingsKey` resolves `AI_EMBEDDINGS_API_KEY`, then `AI_API_KEY` when
`AI_PROVIDER` is `openai` (the embeddings endpoint takes the same key), then
the account's stored `embeddings_api_key`, then nothing → lexical search. The
`corrupt` flag keeps its meaning and applies only to the stored-key branch.

### `/agents` is the settings screen, and nothing else

The page renders `AiConfig` directly — no tabs, no client-side fetch to decide
a landing tab. `AiPlayground` and `AiUsageCard`, and the routes behind them,
stay in the repository unreferenced by client navigation: the `/admin` surface
in `client-provisioning` is the natural home for both, and deleting them now
means writing them again in the next change.

### Gating is subtraction only

`GATED_FEATURE_PREFIXES` loses `/agents`, the doc comments lose "AI Agents",
and the sidebar entry moves out of the gated branch. The middleware matcher
keeps `/agents` (it still needs auth), it just stops matching the gated-prefix
test.

## Risks / Trade-offs

- **`is_active` changes meaning under existing rows.** A row with
  `is_active = false` today means "AI is off entirely"; after this change it
  means "drafts off". The migration backfills every existing row to `true`,
  because in practice that `false` marks a BYO-key setup that was never
  finished, and drafts are a review-before-send surface — nothing reaches a
  patient without a human pressing send. The one unattended surface,
  `auto_reply_enabled`, is not touched by the backfill.
- **A deployment key means one bill for every client's usage.** Out of scope
  here by decision, but `ai_usage_log` already records per-account tokens, so
  the data for a future cap exists from day one.
- **Dropping `NOT NULL` on `api_key` is one-way.** Once a row is written with a
  null key, restoring the constraint requires deleting or repairing those rows.
  Rollback of the code is safe; rollback of the schema is not.
- **Unreferenced components** (`AiPlayground`, `AiUsageCard`, the playground and
  usage routes) are dead weight until `/admin` picks them up. If that change
  slips, they should be deleted rather than left indefinitely.
- **The guardrail is instruction-level, not enforcement-level.** A model can
  still produce a non-compliant sentence. Auto-reply is off by default and every
  other surface is human-reviewed, which is the actual control; the prompt
  clause lowers the rate, it does not guarantee compliance.

## Migration Plan

1. Agent writes `supabase/migrations/045_centralized_ai_config.sql`, idempotent
   like its neighbours: drop `NOT NULL` from `ai_configs.api_key`, `provider`
   and `model`; add `followup_style` with its CHECK and `friendly` default;
   set the `is_active` column default to `true` and backfill existing rows.
2. **Operator applies it manually** and sets `AI_PROVIDER`, `AI_MODEL`,
   `AI_API_KEY` (and optionally `AI_EMBEDDINGS_API_KEY`) in the deployment
   environment. The agent does not run `supabase db push` or `psql`.
3. Rebuild is required: `NEXT_PUBLIC_INCOMPLETE_FEATURES_ENABLED` is inlined
   into the client bundle, so `/agents` leaving the gated set only takes effect
   on a new build.
4. Rollback: revert the code. The added column and the relaxed constraints are
   compatible with the previous code as long as no row has a null `api_key` —
   after any account has saved under the new code, roll forward instead.
