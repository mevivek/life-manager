# life-manager

Personal life-management app: documents, physical assets, money, people, notes, and
eventually a secrets/password vault. Built incrementally, almost entirely across separate
AI-agent sessions.

**This file is a router, not a summary.** It exists so a new session can orient in one
read, then open only what its task needs. Full index: [`docs/README.md`](docs/README.md).

---

## Status

**[M0](docs/roadmap.md) done and verified on a real phone.** The monorepo, API, web app, database
schema, auth and CI exist and work. `pnpm typecheck lint test build` are green and 40 tests pass.

**It has run on the real domain, not just `localhost`.** Verified 2026-07-27 over a Cloudflare
Tunnel serving `app.mevivek.dev` and `api.mevivek.dev`: 21/21 public checks, including the
cross-subdomain session cookie from [ADR-0019](docs/decisions/0019-same-site-subdomain-deployment.md)
— which is the one thing `localhost` cannot exercise. The PWA installs. Google sign-in works and
created a real account with a personal space. Schema is applied to the Neon dev branch.

**It is deployed, and nothing runs on the maintainer's laptop.** `app.mevivek.dev` is Cloudflare
Pages (builds on push from `main`); `api.mevivek.dev` is Cloud Run, scale-to-zero
([ADR-0021](docs/decisions/0021-cloud-run-for-the-api.md), superseding ADR-0014's Fly choice);
Postgres is Neon. Re-verify any deploy with `node scripts/verify-deployment.mjs` — 23 checks,
including the ones `localhost` structurally cannot perform.

**One asymmetry to know:** the web app deploys on push, the API does **not** — API deploys still
need `gcloud` from a terminal (debt D22). So a session without shell access can ship web changes
but not API changes.

What does **not** exist yet: any domain table (`documents` is [M1](docs/roadmap.md)), R2 or any
file handling, Web Push, pg-boss job handlers (the lifecycle is wired, `registerJobs` is empty and
**scheduled jobs are deliberately off in development**), full-text search, `Idempotency-Key`
handling, password reset, and Playwright. Several of those look like missing conventions rather
than deferred work — they are in the
[debt register](docs/product/review.md#3-debt-register) as D9–D20 with triggers, so check there
before "fixing" one.

**What blocks progress:** **Q1 and Q2** in
[open-questions.md](docs/product/open-questions.md) block M1's schema and forms. Nothing else —
the work is on `main`, deployed, and verified.

---

## Doing X? Read Y.

| Task | Read |
|---|---|
| Anything touching **auth, ownership, or crypto** | [`docs/security-model.md`](docs/security-model.md) **in full**, first |
| Working on **Documents** | [`docs/domains/documents.md`](docs/domains/documents.md) |
| **Adding an endpoint** | [`docs/agent-playbooks/add-an-endpoint.md`](docs/agent-playbooks/add-an-endpoint.md) |
| **Adding a domain** | [`docs/agent-playbooks/add-a-domain.md`](docs/agent-playbooks/add-a-domain.md) |
| **Changing the schema** | [`docs/agent-playbooks/change-the-schema.md`](docs/agent-playbooks/change-the-schema.md) |
| **Deciding what to build, or shaping a technical call** | [`docs/product/brain.md`](docs/product/brain.md) — the project brain |
| **Reviewing a finished milestone** | [`docs/product/review.md`](docs/product/review.md) |
| **"Why is it like this?"** | [`docs/decisions/index.md`](docs/decisions/index.md) |
| **Running it locally for the first time** | [`README.md`](README.md) § Getting started |
| **"Is this missing, or deferred?"** | [debt register](docs/product/review.md#3-debt-register) — D9–D17 are M0's known gaps, each with a trigger |
| Anything else | [`docs/README.md`](docs/README.md) routing table |

**Baseline is three files: this one, the routing table, and the one doc your task names.**
There is more documentation than any single session should read — route to it, don't sweep
it ([read budget](docs/README.md#read-budget)).

---

## Invariants

Non-negotiable. Breaking one is a bug even if tests pass. Each links to its reasoning.

1. **Only `apps/api` touches Postgres or R2.** No client, build step, or script outside it
   holds a database URL or storage credential.
   ([ADR-0002](docs/decisions/0002-api-first-decoupling.md))
2. **Records belong to a *space*, never a user.** Every domain table carries `space_id`.
   ([ADR-0006](docs/decisions/0006-space-based-ownership.md))
3. **Every repository function takes `actor: ActorContext` first** and filters
   `space_id IN actor.spaceIds` and `deleted_at IS NULL`.
   ([conventions/code.md](docs/conventions/code.md) §2)
4. **Cross-space access returns 404, never 403.** A 403 confirms the record exists.
   ([conventions/api.md](docs/conventions/api.md) §3)
5. **No business logic in a client.** Client validation is UX only; the server is
   authoritative. A rule only in the web app does not exist — Android won't have it.
6. **The API chooses every storage object key.** Clients never supply one.
   ([ADR-0008](docs/decisions/0008-object-storage-r2.md))
7. **No application-level encryption of ordinary data.** Encryption is vault-only, and that
   is what keeps OCR, search, and reminders possible.
   ([ADR-0009](docs/decisions/0009-sensitivity-tiers.md))
8. **Never hand-roll crypto.** Fixed primitives in
   [security-model.md](docs/security-model.md) §5.
9. **Zod schemas in `packages/shared` are the only contract source.** Never hand-write a
   type that mirrors a schema. ([ADR-0004](docs/decisions/0004-zod-single-contract-source.md))
10. **Never weaken a test to get a green build.**
    ([conventions/testing.md](docs/conventions/testing.md) §5)
11. **No secrets in the repo.** Not in code, docs, commit messages, or `.env` files.
12. **The AI proposes; the human decides product scope.** Nothing reaches the roadmap
    without an explicit yes. ([ADR-0017](docs/decisions/0017-product-brain.md))

---

## Stack (installed — versions are what `pnpm install` actually resolved)

| Layer | Choice | Version | ADR |
|---|---|---|---|
| Runtime | Node.js | **22.15** (`.node-version`, `engines`) | — |
| Package manager | pnpm | **11.17** (`packageManager`) | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Language | TypeScript `strict` + `noUncheckedIndexedAccess` | **7.0** (Go-native `tsgo`) | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Monorepo | pnpm workspaces + Turborepo | turbo 2.10 | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Contract | Zod | **4.4** | [0004](docs/decisions/0004-zod-single-contract-source.md) |
| Web | Vite + React SPA, PWA via `vite-plugin-pwa` | vite 8.1 · react 19.2 · pwa 1.3 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| Routing / data | TanStack Router + TanStack Query | router 1.170 · query 5.101 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| UI | Tailwind v4 + shadcn/ui primitives | tailwind 4.3 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| API | Fastify + `fastify-type-provider-zod` → OpenAPI 3.1 | fastify 5.10 · provider 7.0 | [0004](docs/decisions/0004-zod-single-contract-source.md) |
| Database | Postgres 18 on Neon | 18.4 | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| ORM | Drizzle + drizzle-kit | 0.45 / 0.31 | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| Auth | Better Auth, self-hosted in our Postgres | 1.6 | [0007](docs/decisions/0007-better-auth-self-hosted.md) |
| Files | Cloudflare R2, private, presigned URLs | **not installed — M1** | [0008](docs/decisions/0008-object-storage-r2.md) |
| Jobs | pg-boss on the same Postgres — no Redis | 12.26, zero handlers | [0012](docs/decisions/0012-pg-boss-background-jobs.md) |
| Tests | Vitest (real Postgres) + MSW; Playwright **not installed** | vitest 4.1 · msw 2.15 | [0016](docs/decisions/0016-testing-and-tooling.md) · [0018](docs/decisions/0018-testcontainers-for-api-tests.md) |
| Lint/format | Biome | 2.5 | [0016](docs/decisions/0016-testing-and-tooling.md) |
| Hosting | Cloudflare Pages · Fly.io · Neon · R2 | configured, **never deployed** | [0014](docs/decisions/0014-hosting-topology.md) · [0019](docs/decisions/0019-same-site-subdomain-deployment.md) |

**Version couplings — bumping one of these forces the others:**
`@vitejs/plugin-react@6` peer-requires `vite@^8` exactly · `fastify-type-provider-zod@7` needs
`zod >=4.2` **and** `@fastify/swagger >=9.5.1` · `@better-auth/drizzle-adapter` peer-requires
`drizzle-orm ^0.45.2`, and `better-auth` itself sets the Zod floor · Vitest 4 dropped
`vitest.workspace.ts` for `test.projects` · Turbo 2 renamed `pipeline` to `tasks` · Tailwind 4 has
no `tailwind.config.js` · pnpm 11 reads settings from `pnpm-workspace.yaml`, **not** `.npmrc`.

**Before proposing a stack change, read [`docs/decisions/index.md`](docs/decisions/index.md)
— the alternative was probably already considered and rejected for a reason that still
holds.** Notably: Next.js, Supabase, Prisma, Redis, tRPC, GraphQL, and offline-first sync
were each evaluated and declined.

---

## Layout

```
apps/web/          Vite React SPA (PWA) — the first client
  src/routes/        TanStack Router file routes. `_authed.tsx` guards everything under it
  src/features/      One folder per domain: components, hooks, forms
  src/components/ui/ shadcn-style primitives
  src/lib/           api.ts (the ONE typed client), auth-client, query-client, api-origin
apps/api/          Fastify — the ONLY thing that touches Postgres and R2
  src/domains/<d>/   <d>.routes.ts → <d>.service.ts → <d>.repository.ts, + <d>.test.ts
  src/db/            client, columns, schema/, migrate, seed, and scoped.ts — THE tenant filter
  src/auth/          Better Auth setup, the actor hook, ActorContext
  src/jobs/          pg-boss lifecycle; registerJobs() is empty until M1
  src/lib/           env, logger, errors, problem+json, openapi, security plugin
  src/test/          global-setup, per-file setup, factories, describeDb
  drizzle/           committed migration SQL
packages/shared/   Zod schemas + inferred types, imported by both
docs/              See docs/README.md
```

**Two files are worth reading before touching anything space-scoped:**
`apps/api/src/db/scoped.ts` (the only place the tenant filter is written) and
`apps/api/src/db/schema/scoped-columns.ts` (the columns and index every domain table gets).

---

## Conventions

**Real now.** [`docs/conventions/`](docs/conventions/) describes them; these enforce them:

| Enforced by | What |
|---|---|
| `biome.json` | Format + lint. `pnpm lint`, `pnpm format`. `no-explicit-any`, `noNonNullAssertion`, `noFloatingPromises` are **errors** |
| `tsconfig.base.json` | `strict` + `noUncheckedIndexedAccess`, monorepo-wide |
| `turbo.json` | `pnpm typecheck`, `pnpm build` — ordered so `packages/shared` builds first |
| `vitest.config.ts` (root) | `pnpm test` runs all three packages |
| `.github/workflows/ci.yml` | typecheck → lint → test → build on every push and PR, no secrets |

Two traps worth knowing before you edit tooling config:

- **`biome.json` must not contain comments.** Biome silently falls back to its defaults when it
  cannot deserialise the config, so one `//` turns into every file failing `format` with nothing
  naming the cause.
- **`pnpm` settings live in `pnpm-workspace.yaml`**, not `.npmrc`. Install scripts are blocked by
  default and allowlisted there.

Database-backed tests need Docker or `TEST_DATABASE_URL`; with neither they **skip, not fail**
([ADR-0018](docs/decisions/0018-testcontainers-for-api-tests.md)) — so a green `pnpm test` does not
by itself mean the API was tested. Check the skip count.

---

## Working agreements

- **One domain at a time.** Finish and actually use it before starting the next. Six
  shallow domains are worth less than one good one
  ([product/brain.md](docs/product/brain.md) §5).
- **Pre-v1, the dev database may be reset rather than migrated** — until M3
  ([ADR-0011](docs/decisions/0011-pre-v1-schema-resets.md)).
- **Multi-user isolation is a day-one requirement**, even with one user
  ([ADR-0006](docs/decisions/0006-space-based-ownership.md)).
- **A new architectural decision gets an ADR** under `docs/decisions/`. A commit message or
  chat reply is not visible to the next session.
- **A new product idea goes in [the backlog](docs/product/idea-backlog.md)** with a status,
  including if it's rejected — with the reason.
- **A change that alters an invariant updates the docs in the same commit.**
- **Docs use the [glossary's](docs/glossary.md) words.** Say *space*, not tenant or org.
