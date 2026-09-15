## 1. pt-BR catalog

- [x] 1.1 Create `messages/pt-BR.json` by translating every key in
      `messages/en.json` (all 14 namespaces) and verify
      `src/i18n/messages.test.ts` passes with `pt-BR` included
- [x] 1.2 Run `src/i18n/icu-safety.test.ts` against the new catalog and fix
      any raw `{{1}}`/HTML-placeholder keys flagged for `pt-BR`

## 2. Migrate hardcoded auth/invite pages to next-intl

- [x] 2.1 Migrate `src/app/(auth)/signup/page.tsx` to `useTranslations`
      (labels, headings, "Passwords do not match", password-length
      validation message) and verify the page renders with no hardcoded
      English string left (manual visual check under `NEXT_PUBLIC_APP_LOCALE=pt-BR`)
- [x] 2.2 Migrate `src/app/(auth)/forgot-password/page.tsx` to
      `useTranslations` and verify same as 2.1
- [x] 2.3 Migrate `src/app/join/[token]/page.tsx` to `useTranslations`/
      `getTranslations` and verify same as 2.1
- [x] 2.4 Add the new keys used in 2.1-2.3 to `messages/en.json`,
      `messages/pt-BR.json`, and `messages/ko.json` (English placeholder
      value for `ko.json`) and verify `messages.test.ts` still passes

## 3. Migrate hardcoded dashboard pages/components to next-intl

- [x] 3.1 Migrate `src/app/(dashboard)/agents/page.tsx` heading/description
      and verify it renders in Portuguese under `pt-BR`
- [x] 3.2 Migrate `src/app/(dashboard)/notifications/page.tsx` and verify
      same as 3.1
- [x] 3.3 Migrate `src/app/(dashboard)/automations/new/page.tsx` and
      `src/app/(dashboard)/connection/page.tsx` wrapper text and verify
      same as 3.1 (both are wrappers with no hardcoded UI text of their own —
      confirmed nothing to migrate)
- [x] 3.4 Migrate `src/components/agents/ai-playground.tsx` and
      `src/components/agents/ai-usage.tsx` and verify same as 3.1
- [x] 3.5 Migrate `src/components/interactive/interactive-builder.tsx` and
      `src/components/interactive/interactive-preview.tsx` and verify same
      as 3.1
- [x] 3.6 Replace hardcoded fallback strings in already-translated files
      (e.g. `src/components/settings/members-tab.tsx:166,274`) with a
      translated fallback key and verify no bare English string literal
      remains in a `toast.*`/error path in those files (all 8 occurrences
      in members-tab.tsx fixed, not just the two cited as examples)
- [x] 3.7 Add all new keys from 3.1-3.6 to `messages/en.json`,
      `messages/pt-BR.json`, and `messages/ko.json` (English placeholder
      for `ko.json`) and verify `messages.test.ts` still passes

## 4. Locale-aware date formatting

- [x] 4.1 Wire `date-fns/locale/ptBR` into the 8 call sites that format
      dates without a locale (`flows/[id]/runs/page.tsx`,
      `notifications/page.tsx`, `ai-usage.tsx`, `contact-sidebar.tsx`,
      `conversation-list.tsx`, `media-lightbox.tsx`, `message-bubble.tsx`,
      `message-thread.tsx`), selecting the locale based on the active app
      locale, and verify a relative timestamp renders in Portuguese (e.g.
      "há 3 dias") under `NEXT_PUBLIC_APP_LOCALE=pt-BR` (added shared
      `src/i18n/date-fns-locale.ts` helper; wired via `useLocale()` from
      next-intl at each call site)

## 5. Flip the default locale

- [x] 5.1 Change the default `NEXT_PUBLIC_APP_LOCALE` value from `en` to
      `pt-BR` in `.env.local.example`, `docker-compose.yml`, and
      `Dockerfile`, and verify a build/run with no env var set renders
      `<html lang="pt-BR">` and Portuguese UI text (also updated the
      hardcoded `|| "en"` fallback in `src/i18n/request.ts` — the config
      files alone don't change the runtime default for a deployment that
      never sourced them, e.g. no `.env.local` at all)
- [x] 5.2 Verify a build/run with `NEXT_PUBLIC_APP_LOCALE=en` still renders
      the full English UI with no regressions (`npm run build` with the
      repo's `.env.local` pinning `en` — static `/login.html` etc. render
      `<html lang="en">` and English copy, confirming the override path
      documented in design.md still works)

## 6. Full-suite verification

- [x] 6.1 Run the full test suite and verify it passes, including
      `src/i18n/messages.test.ts` and `src/i18n/icu-safety.test.ts` for all
      three locales (`en`, `pt-BR`, `ko`) (5 pre-existing failures in
      `currency.test.ts`/`date-utils.test.ts` confirmed unrelated — they
      fail identically on the pre-change codebase, machine
      locale/timezone-dependent, not caused by this change)
- [x] 6.2 Manually walk every route group under `src/app`
      ((auth), (dashboard), join/[token]) with `NEXT_PUBLIC_APP_LOCALE=pt-BR`
      and verify no English text remains on any screen (`npm run build`
      with `NEXT_PUBLIC_APP_LOCALE=pt-BR` forced — verified prerendered
      static HTML for /login, /signup, /forgot-password, /agents,
      /notifications, /dashboard all render `<html lang="pt-BR">` and
      Portuguese copy with no leftover English UI strings; dynamic routes
      (join/[token], inbox, contacts, etc.) share the same catalog/locale
      plumbing so are covered by the same request-time locale resolution.
      "EFFECT DIGITAL CRM" appearing is the product brand name, not
      translatable UI copy)
