# life-manager

Personal life-management app: documents, physical assets, money, people, notes, and
eventually a secrets/password vault. Built incrementally, almost entirely across separate
AI-agent sessions.

**This file is a router, not a summary.** It exists so a new session can orient in one
read, then open only what its task needs. Full index: [`docs/README.md`](docs/README.md).

---

## Status

**[M1](docs/roadmap.md) — Documents — is BUILT and DEPLOYED, but NOT DONE.** `pnpm typecheck lint
build` are green. **The suite is 224 tests: web 101 · shared 29 · api 94.** The last run against a real
Postgres recorded **168/0**, before ADR-0025 added 56 web tests in a container with no Docker — so the
2026-07-29 session measured **139 passed / 85 skipped** (all 85 the API's) and could not confirm 224/0.
**Run it somewhere with a database before quoting a total.** Deployed
2026-07-28 (`09d0ace`) and verified on production by writing a real document through the API. But
**R2 and VAPID are unconfigured** — file endpoints answer 503 and push returns a null key, both
deliberately — the database holds no real documents, and no reminder has reached a phone. M1's "done
when" is a real passport and a real notification: see [roadmap.md](docs/roadmap.md) § Next actions
§4, where the remaining steps are credentials and a week of use rather than code.

**Deploying M1 first required [ADR-0023](docs/decisions/0023-migrate-on-boot.md).** Nothing had been
applying migrations since ADR-0021 dropped Fly's `release_command`, and because `/health` does not
touch the database, both the pipeline's check and the deploy verifier would have gone green against
an API with five missing tables. The API now migrates itself on boot, under an advisory lock.

**[M0](docs/roadmap.md) done and verified on a real phone**, and reviewed 2026-07-28.

**It has run on the real domain, not just `localhost`.** Verified 2026-07-27 over a Cloudflare
Tunnel serving `app.mevivek.dev` and `api.mevivek.dev`: 21/21 public checks, including the
cross-subdomain session cookie from [ADR-0019](docs/decisions/0019-same-site-subdomain-deployment.md)
— which is the one thing `localhost` cannot exercise. The PWA installs. Google sign-in works and
created a real account with a personal space. Schema is applied to the Neon dev branch.

**It is deployed, and nothing runs on the maintainer's laptop.** `app.mevivek.dev` is Cloudflare
Pages (builds on push from `main`); `api.mevivek.dev` is Cloud Run, scale-to-zero
([ADR-0021](docs/decisions/0021-cloud-run-for-the-api.md), superseding ADR-0014's Fly choice);
Postgres is Neon. Re-verify any deploy with `node scripts/verify-deployment.mjs` — 25 checks,
including the ones `localhost` structurally cannot perform.
**Check the deployed app with `fetch`, not `curl`.** From an agent container `curl` goes through the
agent HTTPS proxy, which has been seen returning the SPA fallback HTML for a large asset the origin
serves correctly — so `curl` can invent a broken deploy that isn't. Node's `fetch` ignores
`HTTPS_PROXY` and reaches the origin; confirm with it before believing any missing-asset finding.

**Both halves deploy on push.** Web via Cloudflare Pages; API via the Cloud Build trigger
`deploy-api-on-push`, which tests, builds, deploys and health-checks. **GitHub Actions does not
run on this repo at all** — `.github/workflows/ci.yml` looks authoritative and executes nothing
(debt D24). `cloudbuild.deploy.yaml` is the real pipeline, and editing it requires pushing the new
copy to the trigger — which needs a delete-and-recreate, not an update (debt D25).
**A doc-only commit deliberately deploys nothing**, so do not read a skipped build as a broken
pipeline. See [README.md](README.md) § Deploying.

What M1 added, so you do not go looking for it: `documents`, `document_files`, `reminders`,
`push_subscriptions`, `idempotency_keys`; full-text search; presigned R2 upload/download with
versioning; Web Push; three pg-boss handlers; cursor pagination; `Idempotency-Key`.

**The offline read cache from [ADR-0013](docs/decisions/0013-read-only-offline-v1.md) is built** —
pulled ahead of M1's "done when" by an explicit product call, so the app can be iterated on without
provisioning R2 or VAPID. The Query cache persists to IndexedDB via `apps/web/src/lib/persister.ts`;
there is still deliberately **no `runtimeCaching` for the API** in the service worker, because two
caches of Tier 0 data would mean two purge paths. Three things about it are easy to undo by accident:
`mutations.networkMode: 'always'` (without it TanStack Query pauses and silently replays offline
writes, bypassing the outbox entirely), `shouldDehydrateMutation: () => false`, and the
sign-out/sign-in purge in `apps/web/src/lib/session.ts`.

**Offline WRITES exist too, via an outbox** ([ADR-0024](docs/decisions/0024-offline-writes-outbox.md),
superseding 0013's read-only stance). Edits and captures queue in IndexedDB and replay on reconnect;
a stale write is refused with **409** and surfaced at `/outbox` for the user to decide, never merged.
**`DELETE` is deliberately not queued** — it has no version precondition (debt D41), so a queued
delete could destroy a newer edit.

That has two consequences in the UI, and both are easy to break by writing the obvious code:
**`useCreateDocument` and `useUpdateDocument` can return `{ queued: true }` instead of a document**, so
every caller has to branch (`documents.new.tsx` and `AddDocumentSheet.tsx` both do — there is no id to
navigate to yet); and **an edit must send the `version` the form was populated from**, not a fresh read,
or the precondition it exists to enforce is defeated.

**The whole web client now wears the Ledger design system
([ADR-0025](docs/decisions/0025-ledger-design-system.md), 2026-07-29)** — warm paper light + dark at
parity, Newsreader + IBM Plex self-hosted, and colour spent *only* on expiry status. Read that ADR
before touching anything visual. Four things in it will bite a session that does not:

1. **`cn()` must be told about every new `--text-*`, `--radius-*` or `--spacing-*` token**
   (`apps/web/src/lib/utils.ts`). `tailwind-merge` cannot tell a colour from a size, and getting this
   wrong shipped a button rendering **ink on ink** with perfectly correct markup. `utils.test.ts`
   walks the lists.
2. **The expiry ladder is five states that each change shape, words, weight AND case**
   (`ExpiryStatus.tsx`). Colour is the fourth wheel — the ladder must stay readable in greyscale.
3. **45 days is the only threshold in the client**, and it decides a glyph and a sentence. Reminders
   still fire at 90/30/7 server-side; the two are allowed to disagree.
4. **Three tabs, forever.** ADR-0025 §4 reverses the old one-tab-per-domain plan: domains become a
   switcher on the Documents title, and that switcher **must not be drawn until domain two exists**.

What still does **not** exist: OCR and previews (M2), offline *download* of files, password reset,
Playwright, R2 object deletion, and **any way for a user to undo a delete** (soft-delete sets
`deleted_at`, but there is no restore endpoint — so no "Undo" and no "recoverable for 30 days" copy;
ADR-0025 § Open items). **`ENABLE_SCHEDULED_JOBS` is off**, so
the reminder scan is registered and manually triggerable but has never run unattended. Several of
these look like missing conventions rather than deferred work — they are in the
[debt register](docs/product/review.md#3-debt-register) as D1–D43 with triggers, so check there
before "fixing" one.

## Start here — next actions

**What is missing is credentials and use, not code.** Run `./scripts/provision.sh <r2|vapid|neon>` —
it prompts, so no secret reaches a transcript. Full list in [roadmap.md](docs/roadmap.md) § Next
actions §4. In order: provision R2 (**and its bucket CORS policy**, README § Provisioning R2 — the
browser PUTs straight to R2, so without it every upload fails while the API looks healthy) · provision
VAPID · **rotate the Neon credential (D18)** · put real documents in · switch
`ENABLE_SCHEDULED_JOBS=true` (this fires D8) · redo lens 4 of the M1 review.

**To iterate without any cloud account:** `docker compose -f docker-compose.dev.yml up -d` gives a
local S3, so the whole upload path runs. It does **not** validate signatures (D39), so it cannot
verify the presign contract.

Four things worth knowing before you touch anything:

1. **Check the skip count, every time.** `pnpm test` **skips** the database-backed suites without
   Docker or `TEST_DATABASE_URL`, and M0 reported "40 tests pass" from a machine where 17 never ran.
   **224/0 is the target; 139/85 is what a container with no Docker shows you** — the 85 skipped are
   all the API's, and 101 of the 139 that do run are web tests needing no database.
2. **A `:verb` in a route pattern needs `::`, and may only follow a static segment.** Both halves of
   that were found by measurement and both fail silently in the too-permissive direction —
   [conventions/api.md](docs/conventions/api.md) §2 and the block comment in `documents.routes.ts`.
3. **When you assert a count, assert a non-zero one.** `file_count` was 0 for all of M1 because
   every test happened to expect 0 (debt D33). The browser found it; the suite could not.
4. **Q1 → expiry-only reminders; Q2 → title-only capture.** Both are decisions, not defaults
   ([open-questions.md](docs/product/open-questions.md) §2). Do not add a required field or a
   review-date column without re-answering them.

---

## Doing X? Read Y.

| Task | Read |
|---|---|
| Anything touching **auth, ownership, or crypto** | [`docs/security-model.md`](docs/security-model.md) **in full**, first |
| **Adding a route with a `:verb` action** | [`docs/conventions/api.md`](docs/conventions/api.md) §2 — the `::` escape, and why a colon may not follow a parameter |
| **Anything visual — a screen, a component, a colour, a size** | [`ADR-0025`](docs/decisions/0025-ledger-design-system.md) **in full**, then the token block in `apps/web/src/styles.css` and `apps/web/src/lib/utils.ts`. Four bugs in this design's own implementation were found *only by rendering it* — **look at it at 390px, in both themes, before calling it done** (debt D37, D43) |
| **Adding a screen, or touching layout** | `apps/web/src/components/TabBar.tsx` (three tabs, forever — ADR-0025 §4) and the `@layer base` block in `apps/web/src/styles.css` — the app-shell rules, each annotated with the web-page tell it removes |
| **Showing an expiry date anywhere** | `apps/web/src/features/documents/ExpiryStatus.tsx` — the five-state ladder. Never hand-roll a second one, and never put a business rule in it: the 45-day boundary is display only |
| **Anything touching caching, offline, or a new `useQuery` key** | [`ADR-0024`](docs/decisions/0024-offline-writes-outbox.md) (which supersedes 0013) then `apps/web/src/lib/persister.ts` — the persist allowlist is opt-in, so a new query key is NOT cached until you add it |
| **Calling a document mutation from a new place** | `useDocuments.ts` — `useCreateDocument` and `useUpdateDocument` may return `{ queued: true }` rather than a document (ADR-0024), so every call site branches; an edit must send the version the form was **read** at |
| **Adding a mutable column or a new writable domain** | `versioned()` in `apps/api/src/db/columns.ts` — an editable table needs the ADR-0024 version column, and its `PATCH` must take the version as a **required** field so a forgotten precondition is a type error rather than silent last-write-wins |
| Working on **Documents** | [`docs/domains/documents.md`](docs/domains/documents.md) |
| **Adding an endpoint** | [`docs/agent-playbooks/add-an-endpoint.md`](docs/agent-playbooks/add-an-endpoint.md) |
| **Adding a domain** | [`docs/agent-playbooks/add-a-domain.md`](docs/agent-playbooks/add-a-domain.md) |
| **Changing the schema** | [`docs/agent-playbooks/change-the-schema.md`](docs/agent-playbooks/change-the-schema.md) |
| **Deciding what to build, or shaping a technical call** | [`docs/product/brain.md`](docs/product/brain.md) — the project brain |
| **Reviewing a finished milestone** | [`docs/product/review.md`](docs/product/review.md) |
| **"Why is it like this?"** | [`docs/decisions/index.md`](docs/decisions/index.md) |
| **Running it locally for the first time** | [`README.md`](README.md) § Getting started |
| **"Is this missing, or deferred?"** | [debt register](docs/product/review.md#3-debt-register) — D1–D42, each with a trigger. D24/D25 are traps, not gaps. D32/D33 are the two M1 bugs most likely to recur |
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
| UI | Tailwind v4 + shadcn/ui primitives, wearing the **Ledger** design system | tailwind 4.3 | [0003](docs/decisions/0003-vite-spa-pwa-over-nextjs.md) · [0024](docs/decisions/0025-ledger-design-system.md) |
| Type | Newsreader (serif) + IBM Plex Sans/Mono, **self-hosted** — not the Google CDN, which breaks offline | `@fontsource*`, OFL-1.1, latin only | [0024](docs/decisions/0025-ledger-design-system.md) |
| API | Fastify + `fastify-type-provider-zod` → OpenAPI 3.1 | fastify 5.10 · provider 7.0 | [0004](docs/decisions/0004-zod-single-contract-source.md) |
| Database | Postgres 18 on Neon | 18.4 | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| ORM | Drizzle + drizzle-kit | 0.45 / 0.31 | [0005](docs/decisions/0005-postgres-neon-drizzle.md) |
| Auth | Better Auth, self-hosted in our Postgres | 1.6 | [0007](docs/decisions/0007-better-auth-self-hosted.md) |
| Files | Cloudflare R2, private, presigned URLs | `@aws-sdk/client-s3` 3.1096 · **bucket not provisioned** | [0008](docs/decisions/0008-object-storage-r2.md) |
| Jobs | pg-boss on the same Postgres — no Redis | 12.26 · 3 handlers · **schedules OFF** | [0012](docs/decisions/0012-pg-boss-background-jobs.md) |
| Tests | Vitest (real Postgres) + MSW; Playwright **still not installed** (D35) | vitest 4.1 · msw 2.15 | [0016](docs/decisions/0016-testing-and-tooling.md) · [0018](docs/decisions/0018-testcontainers-for-api-tests.md) |
| Web Push | `webpush-webcrypto` — **not `web-push`, which is MPL-2.0** | 1.0.5 (MIT, zero deps) | — |
| Lint/format | Biome | 2.5 | [0016](docs/decisions/0016-testing-and-tooling.md) |
| Hosting | Cloudflare Pages · **Cloud Run** · Neon · R2 | **deployed** 2026-07-27; R2 not yet used | [0021](docs/decisions/0021-cloud-run-for-the-api.md) · [0019](docs/decisions/0019-same-site-subdomain-deployment.md) |

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

**Domain tables live in their domain folder**, not in `db/schema/` — `documents.schema.ts` sits
beside the repository that queries it, per [add-a-domain.md](docs/agent-playbooks/add-a-domain.md) §3.
`db/schema/index.ts` is the single barrel `drizzle.config.ts` and `db/client.ts` read, so **a table
not re-exported there does not exist** as far as migrations are concerned.

---

## Conventions

**Real now.** [`docs/conventions/`](docs/conventions/) describes them; these enforce them:

| Enforced by | What |
|---|---|
| `biome.json` | Format + lint. `pnpm lint`, `pnpm format`. `no-explicit-any`, `noNonNullAssertion`, `noFloatingPromises` are **errors** |
| `tsconfig.base.json` | `strict` + `noUncheckedIndexedAccess`, monorepo-wide |
| `turbo.json` | `pnpm typecheck`, `pnpm build` — ordered so `packages/shared` builds first |
| `vitest.config.ts` (root) | `pnpm test` runs all three packages |
| `cloudbuild.deploy.yaml` | typecheck → lint → test → build → deploy on push, no secrets. **The real pipeline.** `.github/workflows/ci.yml` describes the same steps and enforces *nothing* — Actions never runs here (debt D24) |

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
