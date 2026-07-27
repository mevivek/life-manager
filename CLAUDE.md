# life-manager

Personal life-management app: documents, physical assets, money, people, notes, and
eventually a secrets/password vault. Built incrementally, almost entirely across separate
AI-agent sessions.

**This file is a router, not a summary.** It exists so a new session can orient in one
read, then open only what its task needs. Full index: [`docs/README.md`](docs/README.md).

---

## Status

**Pre-code.** Only documentation and architecture decisions exist. No app code, no
dependencies, no CI, no `apps/` or `packages/` directories.

Do not assume any tooling exists — check before relying on it. The stack below is **decided
but not yet scaffolded**. Next step is [M0](docs/roadmap.md).

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

## Stack (decided, not yet scaffolded)

| Layer | Choice | ADR |
|---|---|---|
| Language | TypeScript `strict`, everywhere | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Monorepo | pnpm workspaces + Turborepo | [0001](docs/decisions/0001-typescript-monorepo.md) |
| Web | Vite + React SPA, PWA via `vite-plugin-pwa` | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| Routing / data | TanStack Router + TanStack Query | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| UI | Tailwind v4 + shadcn/ui | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) |
| API | Fastify 5 + `fastify-type-provider-zod` → OpenAPI 3.1 | [0004](docs/decisions/0004-zod-single-contract-source.md) |
| Database | Postgres 17 on Neon | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| ORM | Drizzle + drizzle-kit | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| Auth | Better Auth, self-hosted in our Postgres | [0007](docs/decisions/0007-better-auth-self-hosted.md) |
| Files | Cloudflare R2, private, presigned URLs | [0008](docs/decisions/0008-object-storage-r2.md) |
| Jobs | pg-boss on the same Postgres — no Redis | [0012](docs/decisions/0012-pg-boss-background-jobs.md) |
| Tests | Vitest (real Postgres), Playwright, MSW | [0016](docs/decisions/0016-testing-and-tooling.md) |
| Lint/format | Biome | [0016](docs/decisions/0016-testing-and-tooling.md) |
| Hosting | Cloudflare Pages · Fly.io · Neon · R2 | [0014](docs/decisions/0014-hosting-topology.md) |

**Before proposing a stack change, read [`docs/decisions/index.md`](docs/decisions/index.md)
— the alternative was probably already considered and rejected for a reason that still
holds.** Notably: Next.js, Supabase, Prisma, Redis, tRPC, GraphQL, and offline-first sync
were each evaluated and declined.

---

## Planned layout

Does not exist yet. Created in [M0](docs/roadmap.md).

```
apps/web/          Vite React SPA (PWA) — the first client
apps/api/          Fastify — the ONLY thing that touches Postgres and R2
packages/shared/   Zod schemas + inferred types, imported by both
docs/              See docs/README.md
```

---

## Conventions

**Not yet established in code** — no lint config, test framework, or CI exists. The intended
conventions are written up in [`docs/conventions/`](docs/conventions/) and become real at
M0. **Update this section when they do.**

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
