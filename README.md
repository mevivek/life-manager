# life-manager

A personal life-management app — one coherent place for the documents, possessions, money,
people, and secrets that make up a life.

**Status: M0 scaffold complete, not yet deployed.** The monorepo, API, web app, database schema,
auth and CI all work locally. Nothing has run anywhere but `localhost` yet — see
[`docs/roadmap.md`](docs/roadmap.md) for what remains.

---

## The idea

Single-domain tools already exist and are good. Paperless-ngx does documents. Firefly III
does money. Bitwarden does secrets. The bet here isn't to beat any of them at their own
domain — it's that **the interesting questions cross domains**:

> *What does this warranty cover, what did it cost, who sold it to me, where's the receipt,
> and when does it expire?*

No single-domain tool can answer that.

## What it will be

- **Documents** — identity papers, contracts, warranties, receipts, certificates, with
  expiry reminders that actually fire
- **Assets** — what you own, where it is, what it's worth
- **Money** — what you own and owe (not a budgeting app)
- **People** — who matters and what you need to remember about them
- **Notes** — everything that doesn't fit the above
- **Vault** — an end-to-end encrypted password and secrets store

Built one domain at a time, starting with Documents.

## Design constraints

- **Multi-user from day one**, though it starts as a single-user app
- **Synced across devices** — phone and laptop, server as the source of truth
- **Backend and frontend fully decoupled**, so native mobile clients are plug-and-play
- **Web client is a PWA** — installable, works offline for reading
- **Family sharing** is a near-term goal, so ownership is modeled on shared *spaces* from
  the first table
- **End-to-end encryption for the vault** — designed up front so it doesn't require a
  redesign later
- Built almost entirely by AI-agent sessions, which shapes nearly every decision below

## Stack

TypeScript throughout. Vite + React PWA, Fastify API, Postgres on Neon with Drizzle, Better
Auth, Cloudflare R2 for files, pg-boss for background jobs.

Rationale for each choice — and the alternatives rejected — is in
[`docs/decisions/`](docs/decisions/index.md).

## Documentation

Everything lives in [`docs/`](docs/README.md), organized so a fresh reader (human or AI) can
orient from two or three files:

| | |
|---|---|
| [`docs/README.md`](docs/README.md) | Start here — a "doing X? read Y" routing table |
| [`docs/architecture.md`](docs/architecture.md) | How the system fits together |
| [`docs/security-model.md`](docs/security-model.md) | Trust boundaries, data sensitivity, the vault design |
| [`docs/decisions/`](docs/decisions/index.md) | Why each choice was made, and what was rejected |
| [`docs/domains/`](docs/domains/) | One spec per life domain |
| [`docs/product/`](docs/product/brain.md) | Vision, principles, and the idea backlog |
| [`docs/roadmap.md`](docs/roadmap.md) | What's next |

[`CLAUDE.md`](CLAUDE.md) is the entry point for AI sessions.

## Getting started

### Prerequisites

- **Node 22.15+** — `.node-version` pins it
- **pnpm 11** — `corepack enable pnpm`, or `npm i -g pnpm` if Corepack cannot write to your Node
  install directory (it needs admin on Windows)
- **A Neon account** with a project and a `dev` branch
- **Docker Desktop — optional.** Only for running the database-backed API tests; see below

### Setup

```bash
pnpm install
```

Then fill in `apps/api/.env`. It is created for you with placeholders and comments, and three
lines need a real value — the two Neon connection strings (pooled *and* direct; they are not
interchangeable) and a generated `BETTER_AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

`.env` files are gitignored and must stay that way. `.env.example` at the repo root documents
every variable and holds **no values**.

Create the schema on your Neon dev branch, then start both apps:

```bash
pnpm --filter api db:push     # pre-v1 you may reset rather than migrate — ADR-0011
pnpm dev                      # api on :8080, web on :5173
```

Open <http://localhost:5173> and sign up. The Vite dev server proxies `/api` to the API, so
everything is same-origin locally and cookies need no special handling.

### The commands

| Command | What |
|---|---|
| `pnpm dev` | Both apps, watching |
| `pnpm typecheck` | `tsc` across all three packages |
| `pnpm lint` / `pnpm format` | Biome, check / write |
| `pnpm test` | Vitest: shared, api, web |
| `pnpm build` | shared → api → web |
| `pnpm --filter api db:generate` | Generate a migration from the Drizzle schema |
| `pnpm --filter api db:migrate` | Apply committed migrations |
| `pnpm --filter api db:seed` | Idempotent; repairs any user missing a personal space |
| `pnpm --filter api auth:generate` | Regenerate Better Auth's tables — read the header comment in `src/db/schema/auth.ts` first |

### Running the database-backed tests

The API's integration tests need a real Postgres
([ADR-0018](docs/decisions/0018-testcontainers-for-api-tests.md)). Two ways, in priority order:

1. **Set `TEST_DATABASE_URL`** in `apps/api/.env` to any throwaway Postgres. No Docker needed.
   The harness creates one database per test worker on that server and **truncates tables between
   tests** — so never point it at anything you care about, and never at your Neon dev branch.
2. **Start Docker Desktop** and set nothing. The harness starts a `postgres:17-alpine`
   Testcontainer for the run and throws it away afterwards.

With **neither**, `pnpm test` still passes — the database suites **skip** rather than fail, and
print a box telling you so. That is deliberate, so a fresh clone is not red by default. It also
means **a green `pnpm test` does not by itself prove the API was tested** — check the skip count.
CI has a Postgres service container and fails rather than skipping.

### Deploying

Not done yet, and the configs have never been executed. `apps/api/fly.toml` and
`apps/api/Dockerfile` carry the steps in comments;
[ADR-0019](docs/decisions/0019-same-site-subdomain-deployment.md) explains why the app and API must
be subdomains of one domain rather than on `*.pages.dev` and `*.fly.dev`.

## License

Not yet chosen. Personal project.
