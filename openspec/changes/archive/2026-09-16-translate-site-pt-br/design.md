## Context

See `proposal.md` - Why. Locale is already selected via `next-intl`'s
`getRequestConfig` (`src/i18n/request.ts`), which reads
`NEXT_PUBLIC_APP_LOCALE` (default `"en"`) and dynamically imports
`messages/${locale}.json`, falling back to `messages/en.json` if that file
doesn't exist. `src/app/layout.tsx` already wires `getLocale()`/
`getMessages()` into `<html lang>` and `NextIntlClientProvider` - none of
that plumbing changes. Two catalogs exist today (`en.json`, `ko.json`) with
parity enforced by `src/i18n/messages.test.ts`, and `src/i18n/icu-safety.test.ts`
guards against raw `{{1}}`/HTML-style placeholders that break next-intl's
ICU parser (historical bug, issue #421). See `specs/localization/spec.md`
for the behavior this design implements.

## Goals / Non-Goals

**Goals:**
- Make `pt-BR` the default locale for deployments that don't override it.
- Bring every remaining hardcoded-English screen/component under
  `next-intl`, with pt-BR translations at full key parity.
- Make relative/absolute dates locale-aware.

**Non-Goals:**
- No runtime language switcher, no `[locale]` URL segment, no per-user
  language preference (user decision - locale stays one build-time choice
  per deployment).
- No translation of Supabase's default auth emails (not app-rendered
  templates today - see proposal.md Impact).
- No Korean (`ko.json`) translation work beyond keeping the parity test
  green (new keys get an English placeholder value, matching how `ko.json`
  would already fall back to `en.json` today for any key it's missing).

## Decisions

**Keep the single build-time-locale architecture instead of adding a
switcher.** The existing self-hosted model (one locale per deployment, set
via env var, same mechanism `ko` already uses) is what the user chose to
keep. Adding a switcher would require a `[locale]` route segment or a
client-side locale cookie plus middleware negotiation - out of scope per the
proposal.

**Add `pt-BR` as a full sibling catalog, not a code-level string
replacement.** Alternative considered: hardcode Portuguese strings directly
in components and drop `next-intl`. Rejected - it would throw away working
infrastructure (two catalogs, parity + ICU-safety tests already exist) and
regress the `ko.json` locale that already depends on that infrastructure.

**Migrate hardcoded strings by following the existing
`useTranslations`/`getTranslations` pattern already used by the 82 files
that have it**, adding new namespaced keys (e.g. `Agents.title`,
`Notifications.*`, `Signup.*`, `ForgotPassword.*`, `JoinInvite.*`) rather
than reusing unrelated existing keys, so each string's translation can be
edited independently.

**Use `date-fns/locale/ptBR`** (the locale `date-fns` already ships) in the
8 files that call `date-fns` formatting functions without a locale, selected
based on the active app locale. Alternative considered: switch to
`Intl.RelativeTimeFormat`/`Intl.DateTimeFormat` instead of `date-fns` -
rejected as a larger, unrelated refactor of code that already works and
isn't broken, just unlocalized.

**Hardcoded fallback strings in already-translated files** (e.g.
`members-tab.tsx:166,274` - `payload.error || "Failed to load invitations"`)
get replaced with a translated fallback key, since the fallback text is
still user-facing UI copy even though it's conditional.

## Risks / Trade-offs

- [Changing the default locale is a breaking change for any deployment that
  doesn't pin `NEXT_PUBLIC_APP_LOCALE` today] → Call it out explicitly as
  **BREAKING** in the proposal and in the deployment docs/env example
  comment; the fix for an affected deployment is a one-line env var.
- [Missing a hardcoded string during migration would leave English text
  mixed into an otherwise-Portuguese page] → `src/i18n/messages.test.ts`
  catches missing/orphaned keys across catalogs, but it can't catch a string
  that was never extracted into a key at all; mitigate with a manual sweep
  of the file list in proposal.md's "What Changes" plus a visual pass over
  each affected page after migration (see tasks.md verification steps).
- [Adding many new keys to `pt-BR.json` in one pass risks copy quality
  issues (machine-translation feel, inconsistent terminology)] → Reuse
  existing terminology already established in `en.json`'s structure and any
  Portuguese strings already present in the codebase (e.g. README brand
  copy) for consistency; this is a content-review concern, not a
  spec/behavior concern.

## Migration Plan

1. Add `messages/pt-BR.json` with parity to `en.json` for all existing keys.
2. Migrate each hardcoded-string file to `next-intl`, adding new keys to
   `en.json`, `pt-BR.json`, and `ko.json` (English placeholder for `ko.json`)
   as they're introduced.
3. Wire `date-fns/locale/ptBR` into the 8 unlocalized date-formatting call
   sites.
4. Flip the default `NEXT_PUBLIC_APP_LOCALE` to `pt-BR` in
   `.env.local.example`, `docker-compose.yml`, and `Dockerfile` last, once
   the catalog and migrations are verified complete - this keeps the app
   running in English (already fully covered) throughout steps 1-3, and only
   changes the rendered default once pt-BR coverage is confirmed complete.
5. Rollback: revert the env var default change (step 4) independently of
   the catalog/migration work, since the new catalog and translated
   components are additive and safe to keep even if the default reverts to
   `en`.
