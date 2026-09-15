# @z7/crm

The zero7IA CRM — shared inbox, contacts, sales pipelines, broadcasts, and
no-code automations over WhatsApp. Part of the [z7 monorepo](../../README.md);
see the root `AGENTS.md` for how this app fits with the rest of the platform.

> **⚠️ Unofficial WhatsApp API.** This app connects through
> [UAZAPI](https://uazapi.com), which pairs to an ordinary WhatsApp
> (Business) account rather than going through Meta's official Cloud
> API. This gets you free-form messaging with no template-approval
> queue and no 24-hour session window, but it's unofficial: WhatsApp
> can ban a number used this way, and there is no way to mitigate that
> in code. Use a WhatsApp **Business** account, not your personal
> number, and treat the risk as yours before connecting.

## What's in here

- **Shared inbox** connected over [UAZAPI](https://uazapi.com) — QR code or
  pairing code, no Business verification, no template approval queue. See
  the warning above before connecting a number. Multiple agents work one
  number, with per-conversation assignment, status, and notes.
- **Contacts + tags + custom fields**, CSV import, deduplication.
- **Sales pipelines** (Kanban) with deals linked to conversations.
- **Broadcasts** with free-form messages (text or media with a caption) and
  per-recipient `{{variable}}` substitution, plus delivery + read tracking.
- **No-code automations** — triggers on inbound messages, new contacts,
  keywords, or schedule; conditional branches, waits, tags, webhooks.
- **AI reply assistant** — bring your own OpenAI or Anthropic key (stored
  encrypted). One-click AI-drafted replies, optional auto-reply bot with a
  per-conversation cap and clean human handoff, plus a knowledge base with
  hybrid retrieval (Postgres full-text, or semantic pgvector when an
  embeddings key is set).
- **Real-time dashboard** — response times, daily volume, pipeline value,
  cross-module activity feed.
- **Team accounts** — invite teammates by link, role-based access (owner /
  admin / agent / viewer), ownership transfer.
- **Public REST API** (`/api/v1`) with scoped, revocable API keys. See
  [docs/public-api.md](./docs/public-api.md).
- **MCP server** — drive the CRM from Claude, Cursor, and other AI assistants
  over the [Model Context Protocol](https://modelcontextprotocol.io).
  Read-only by default, opt-in writes. See [docs/mcp.md](./docs/mcp.md)
  (server in [`mcp-server/`](./mcp-server)).

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript, Tailwind v4.
- **Data** — Supabase (Postgres + Auth + Storage + RLS). Migrations live at
  [`packages/db/supabase/migrations`](../../packages/db/supabase/migrations),
  not here — see the root `AGENTS.md`.
- **WhatsApp** — [UAZAPI](https://uazapi.com) (unofficial gateway; QR or
  pairing-code login, no Business verification or template review).

## Dev

This app is a workspace in the z7 bun monorepo — install and run from the
repo root, not from here:

```bash
bun install                        # from the repo root
cp apps/crm/.env.local.example apps/crm/.env.local   # fill in Supabase + UAZAPI creds
bun run --filter @z7/crm dev
```

Open <http://localhost:3000>. You'll be redirected to `/login` (or
`/dashboard` if already signed in).

Prefer containers? See [docs/docker.md](./docs/docker.md) for the Dockerfile
and Docker Compose setup.

## License

[MIT](./LICENSE).
