## Why

The app is a self-hosted CRM template built for a Brazilian Portuguese-speaking
audience (EFFECT DIGITAL), but it ships in English by default and several
newer pages were never wired into the existing `next-intl` translation system.
Users deploying the template today get an English UI unless they hand-edit an
env var and fill in gaps that don't exist yet.

## What Changes

- Add a `messages/pt-BR.json` catalog with full key parity against
  `messages/en.json` (enforced today by `src/i18n/messages.test.ts`), covering
  all 14 existing namespaces (`LoginPage, Sidebar, Header, Connection,
  ModeToggle, AccountAccess, Dashboard, Inbox, Contacts, Pipelines,
  Broadcasts, Automations, Flows, Settings`).
- Migrate the pages/components that currently hold hardcoded English strings
  into `useTranslations`/`getTranslations`, adding whatever new message keys
  they need to both `en.json` and `pt-BR.json`:
  - `src/app/(auth)/signup/page.tsx`
  - `src/app/(auth)/forgot-password/page.tsx`
  - `src/app/join/[token]/page.tsx`
  - `src/app/(dashboard)/agents/page.tsx` (heading/description)
  - `src/app/(dashboard)/notifications/page.tsx`
  - `src/app/(dashboard)/automations/new/page.tsx`
  - `src/app/(dashboard)/connection/page.tsx`
  - `src/components/agents/ai-playground.tsx`, `ai-usage.tsx`
  - `src/components/interactive/interactive-builder.tsx`,
    `interactive-preview.tsx`
  - Hardcoded fallback strings mixed into otherwise-translated files (e.g.
    `src/components/settings/members-tab.tsx:166,274`)
- Wire `date-fns` locale into the 8 files that call it without one
  (`date-fns/locale/ptBR` when the app locale is `pt-BR`), so relative/
  absolute dates stop rendering in English regardless of app locale.
- **BREAKING**: change the default value of `NEXT_PUBLIC_APP_LOCALE` from
  `en` to `pt-BR` in `.env.local.example`, `docker-compose.yml`, and
  `Dockerfile`. Deployments that don't set the env var explicitly will now
  render in Portuguese; English remains available by setting
  `NEXT_PUBLIC_APP_LOCALE=en` (same mechanism `ko` already uses today).
- Out of scope (per user decision): no runtime language switcher, no
  `[locale]` route segment, no per-user language preference — locale stays a
  single build-time choice per deployment, matching the current architecture.
- Out of scope: Supabase's default auth emails (confirmation, magic link,
  password reset) are not app-rendered templates today (commented out in
  `supabase/config.toml`) and are not part of this change.

## Capabilities

### New Capabilities
- `localization`: default app locale, translation catalog completeness
  (key parity across all namespaces/locales), and the requirement that all
  user-facing UI text route through the translation system rather than being
  hardcoded.

### Modified Capabilities
(none — no existing spec'd capability's requirements change; this only adds
the localization capability and touches implementation across many files)

## Impact

- **Config**: `.env.local.example`, `docker-compose.yml`, `Dockerfile`
  (default `NEXT_PUBLIC_APP_LOCALE`).
- **Translation catalog**: new `messages/pt-BR.json`; new keys added to
  `messages/en.json` (and `messages/ko.json` to keep the parity test green —
  English copy is an acceptable placeholder for `ko.json`'s new keys since
  Korean translation is not in scope of this change).
- **Components/pages**: the list under "What Changes" above.
- **Tests**: `src/i18n/messages.test.ts` (key-parity) and
  `src/i18n/icu-safety.test.ts` (ICU placeholder safety) must stay green for
  the new catalog and keys.
- **No dependency changes**: reuses the existing `next-intl` and `date-fns`
  packages already in `package.json`.
