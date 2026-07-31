# Architecture

System-level view of life-manager. Read this after [CLAUDE.md](../CLAUDE.md) and before
touching anything that crosses a package boundary.

For *why* any of these choices were made, see [decisions/index.md](decisions/index.md).
This document describes **what** the system is; the ADRs describe **why**.

---

## 1. Shape of the system

life-manager is an **API-first** application. There is exactly one backend, and every
client is a plain HTTP consumer of it. The web PWA has no privileged access — it is
simply the first client written, and a future Android or iOS app will use the identical
API surface with no server changes.

```
   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
   │  Web PWA      │   │  Android      │   │  iOS          │
   │  (built)      │   │  (future)     │   │  (future)     │
   └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
           │                   │                   │
           └───────────────────┼───────────────────┘
                               │  HTTPS  /api/v1/*
                               │  OpenAPI 3.1 contract
                    ┌──────────▼───────────┐
                    │   apps/api           │
                    │   Fastify + Zod      │
                    │   Better Auth        │
                    │   pg-boss workers    │
                    └──┬────────────────┬──┘
                       │                │
            ┌──────────▼─────┐   ┌──────▼────────┐
            │  Postgres      │   │  Cloudflare   │
            │  (Neon)        │   │  R2           │
            │  data + jobs   │   │  file bytes   │
            └────────────────┘   └───────────────┘
                                         ▲
                                         │ presigned PUT/GET
                                         │ (bytes never transit the API)
                                    clients
```

**The one rule that keeps this shape:** nothing outside `apps/api` holds a database URL or
an R2 credential. See [ADR-0002](decisions/0002-api-first-decoupling.md).

## 2. Repository layout

A pnpm workspace monorepo with three packages
([ADR-0001](decisions/0001-typescript-monorepo.md)):

```
apps/
  web/          Vite + React SPA, installable PWA. The first client.
  api/          Fastify server. The only thing that touches Postgres and R2.
packages/
  shared/       Zod schemas + inferred types. Imported by BOTH apps.
docs/           This directory. See docs/README.md.
```

`packages/shared` is the contract. A schema defined there validates the request body in
the API *and* the form in the web client, and generates the OpenAPI spec — one definition,
three uses ([ADR-0004](decisions/0004-zod-single-contract-source.md)). It contains no
runtime dependencies on either app and must never import from them.

## 3. Technology

**Versions are what `pnpm install` actually resolved.** This is the only stack table in the repo —
`CLAUDE.md` used to carry a second, and the two disagreed about whether R2 was provisioned and
whether jobs were scheduled. It also said Playwright was a test tool and GitHub Actions was CI;
neither is true (debt D35, D24).

| Layer | Choice | Version | ADR |
|---|---|---|---|
| Runtime | Node.js | **22.15** (`.node-version`, `engines`) | — |
| Package manager | pnpm | **11.17** (`packageManager`) | [0001](decisions/0001-typescript-monorepo.md) |
| Language | TypeScript `strict` + `noUncheckedIndexedAccess` | **7.0** (Go-native `tsgo`) | [0001](decisions/0001-typescript-monorepo.md) |
| Monorepo | pnpm workspaces + Turborepo | turbo 2.10 | [0001](decisions/0001-typescript-monorepo.md) |
| Contract | Zod | **4.4** | [0004](decisions/0004-zod-single-contract-source.md) |
| Web | Vite + React SPA, PWA via `vite-plugin-pwa` | vite 8.1 · react 19.2 · pwa 1.3 | [0003](decisions/0003-vite-spa-pwa-over-nextjs.md) |
| Routing / data | TanStack Router + TanStack Query | router 1.170 · query 5.101 | [0003](decisions/0003-vite-spa-pwa-over-nextjs.md) |
| UI | Tailwind v4 + shadcn/ui primitives, wearing the **Ledger** design system | tailwind 4.3 | [0025](decisions/0025-ledger-design-system.md) |
| Type | Newsreader + IBM Plex, **self-hosted** — not the Google CDN, which breaks offline | `@fontsource*`, OFL-1.1 | [0025](decisions/0025-ledger-design-system.md) |
| API | Fastify + `fastify-type-provider-zod` → OpenAPI 3.1 | fastify 5.10 · provider 7.0 | [0004](decisions/0004-zod-single-contract-source.md) |
| Database | Postgres 18 on Neon | 18.4 | [0005](decisions/0005-postgres-neon-drizzle.md) |
| ORM | Drizzle + drizzle-kit | 0.45 / 0.31 | [0005](decisions/0005-postgres-neon-drizzle.md) |
| Auth | Better Auth, self-hosted in our Postgres | 1.6 | [0007](decisions/0007-better-auth-self-hosted.md) |
| Files | Cloudflare R2, private, presigned URLs | `@aws-sdk/client-s3` 3.1096 · provisioned, in use | [0008](decisions/0008-object-storage-r2.md) |
| Jobs | pg-boss on the same Postgres — no Redis | 12.26 · 3 handlers · schedules **off permanently** | [0012](decisions/0012-pg-boss-background-jobs.md) · [0028](decisions/0028-external-trigger-for-the-daily-scan.md) |
| Tests | Vitest (real Postgres) + MSW; Playwright **not installed** (D35) | vitest 4.1 · msw 2.15 | [0016](decisions/0016-testing-and-tooling.md) · [0018](decisions/0018-testcontainers-for-api-tests.md) |
| Web Push | `webpush-webcrypto` — **not `web-push`, which is MPL-2.0** | 1.0.5 (MIT) | [0022](decisions/0022-web-push-library.md) |
| Lint/format | Biome | 2.5 | [0016](decisions/0016-testing-and-tooling.md) |
| Hosting | Cloudflare Pages · **Cloud Run** · Neon · R2 | see [roadmap](roadmap.md#current-position) | [0021](decisions/0021-cloud-run-for-the-api.md) · [0019](decisions/0019-same-site-subdomain-deployment.md) |

**Bumping any one of these forces others** — the coupling list is in [architecture.md § Version couplings](docs/architecture.md#version-couplings).

**Before proposing a stack change, read [`decisions/index.md`](decisions/index.md)** — the
alternative was probably already rejected for a reason that still holds. Next.js, Supabase, Prisma,
Redis, tRPC, GraphQL and offline-first sync were each evaluated and declined.

## 4. API layering

Inside `apps/api`, every request passes through the same four layers. Skipping a layer is
the most common way to introduce a tenant-isolation bug — see
[conventions/code.md](conventions/code.md) for the rules.

```
  HTTP request
      │
      ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 1. Route      Zod schema validates params/query/body.   │
 │               Produces the OpenAPI entry automatically. │
 │               Resolves the session → ActorContext.      │
 ├─────────────────────────────────────────────────────────┤
 │ 2. Service    Business rules. Owns transactions.        │
 │               Knows nothing about HTTP.                 │
 ├─────────────────────────────────────────────────────────┤
 │ 3. Repository Every function takes `actor` first and    │
 │               filters on space_id IN actor.spaceIds.    │
 │               The ONLY layer that writes SQL.           │
 ├─────────────────────────────────────────────────────────┤
 │ 4. Drizzle    Schema definitions, migrations.           │
 └─────────────────────────────────────────────────────────┘
      │
      ▼
  Postgres
```

Cross-cutting concerns sit beside the stack, not inside it: pino logging, error mapping to
RFC 9457 `application/problem+json`, rate limiting, and idempotency-key handling. See
[conventions/api.md](conventions/api.md).

## 5. Request lifecycle — a worked example

`GET /api/v1/documents?expiring_before=2026-12-31`

1. Fastify matches the route. The Zod query schema from `packages/shared` parses
   `expiring_before` into a `Date`, rejecting anything malformed with a 400
   `problem+json` before any handler runs.
2. The auth hook resolves the session cookie (web) or bearer token (native) via Better
   Auth, loads the user's space memberships, and attaches
   `ActorContext { userId, spaceIds, role }` to the request.
3. The route handler calls `documentsService.list(actor, filters)`.
4. The service applies business rules (exclude soft-deleted, default sort by
   `expires_on`) and calls `documentsRepo.list(actor, filters)`.
5. The repository issues a Drizzle query with `space_id IN (actor.spaceIds)` and
   `deleted_at IS NULL`, plus a cursor-based `LIMIT`.
6. The response is serialized through the Zod response schema, so the OpenAPI contract and
   the actual bytes cannot drift.

**Step 5 is the tenant boundary.** It is not optional and not conditional. There is no code
path in which a repository query omits the space filter.

## 6. File handling

Bytes never pass through the API ([ADR-0008](decisions/0008-object-storage-r2.md)).

**Upload:**

1. Client `POST /documents/:id/files:presign-upload` with `{ filename, mime, sizeBytes }`.
2. API verifies the caller may write to that document's space, generates a `fileId`, and
   **chooses the object key itself**:
   `spaces/{spaceId}/documents/{documentId}/{fileId}`.
3. API returns a short-lived presigned PUT URL.
4. Client PUTs the bytes directly to R2.
5. Client `POST`s back to confirm; the API records the `document_files` row and enqueues
   the OCR job.

**The client never supplies the object key.** That is what makes this safe — a malicious
client cannot address another space's storage because it never gets to name anything.
Download is the mirror image with a presigned GET.

## 7. Background jobs

pg-boss runs inside the API process, backed by the same Postgres — no Redis, no separate
service ([ADR-0012](decisions/0012-pg-boss-background-jobs.md)).

| Job | Trigger | Purpose |
|---|---|---|
| `reminders.scan` | cron, daily | Find records whose `due_on - lead_days` is today; enqueue deliveries |
| `reminders.deliver` | queued | Send via the notification channel (Web Push now, FCM/APNs later) |
| `documents.extract-text` | on file upload | OCR → `document_text` → refresh the search index (M2) |

Jobs run in the same process as the API for now. If job load ever justifies it, pg-boss
supports running workers as a separate deployment of the same image with no code change.

## 8. Data model foundations

Two tables underpin every domain ([ADR-0006](decisions/0006-space-based-ownership.md)):

```
users ──┬── space_members ──┬── spaces
        │   (user_id,       │   (id, name, kind)
        │    space_id,      │
        │    role)          │
        │                   │
        └───────────────────┴──► every domain table carries
                                 space_id + created_by
```

A **space** is the unit of ownership and sharing. Every user gets a personal space at
signup. Family sharing, when it arrives, is a second `space_members` row and an invite
screen — no schema change, no query rewrite, no authorization redesign.

Universal column rules are in [conventions/data.md](conventions/data.md).

## 9. Deployment topology

All free or near-free at single-user traffic
([ADR-0021](decisions/0021-cloud-run-for-the-api.md), superseding
[ADR-0014](decisions/0014-hosting-topology.md)).

**This section describes the shape, not the state.** What is deployed and provisioned right now is
asserted in exactly one place — [roadmap.md § Current position](roadmap.md#current-position) — because
restating it in five files is what drifted at M0 and again at M1 (debt **D28**). Do not add a status
claim here.

| Component | Host | Notes |
|---|---|---|
| Web PWA | Cloudflare Pages | Static build, global CDN, no server. Builds on push from `main` |
| API | **Cloud Run** | Node container, `--min-instances=0`. Not Fly — [ADR-0021](decisions/0021-cloud-run-for-the-api.md) |
| Database | Neon | Serverless Postgres, branching, scale-to-zero |
| Files | Cloudflare R2 | Private bucket, zero egress fees. Presigned PUT straight from the browser, so the bucket needs a CORS policy ([README](../README.md) § Provisioning) |

The web build is static and the API is a stateless container, so nothing about this
topology is load-bearing — every component can be moved to another provider without a
code change. That is deliberate.

## 10. What this architecture deliberately does not do

Recorded so a future session doesn't treat an intentional absence as an oversight:

- **No SSR / server-rendered HTML.** The web client is a static SPA
  ([ADR-0003](decisions/0003-vite-spa-pwa-over-nextjs.md)).
- **No background sync.** Offline writes *do* exist, through an explicit outbox: a write made
  offline queues in IndexedDB and replays on reconnect, and a stale write is refused with **409** and
  surfaced for the user to decide, never merged
  ([ADR-0024](decisions/0024-offline-writes-outbox.md), superseding
  [ADR-0013](decisions/0013-read-only-offline-v1.md)'s no-writes half — its read cache stands). What
  is deliberately absent is the *implicit* half: no Background Sync API, no CRDTs, no automatic merge.
- **No GraphQL.** REST with a generated OpenAPI contract
  ([ADR-0004](decisions/0004-zod-single-contract-source.md)).
- **No application-level encryption of ordinary data**
  ([ADR-0009](decisions/0009-sensitivity-tiers.md)).
- **No microservices.** One API, one database.
- **No Redis.** ([ADR-0012](decisions/0012-pg-boss-background-jobs.md))
- **No migration discipline yet.** Pre-v1, the dev database may be reset freely
  ([ADR-0011](decisions/0011-pre-v1-schema-resets.md)).

---

## Version couplings

Bumping one of these forces the others. Moved here from `CLAUDE.md`, which is a router.

`@vitejs/plugin-react@6` peer-requires
`vite@^8` exactly · `fastify-type-provider-zod@7` needs `zod >=4.2` **and** `@fastify/swagger
>=9.5.1` · `@better-auth/drizzle-adapter` peer-requires `drizzle-orm ^0.45.2`, and `better-auth`
sets the Zod floor · Vitest 4 dropped `vitest.workspace.ts` for `test.projects` (and its `basic`
reporter) · Turbo 2 renamed `pipeline` to `tasks` · Tailwind 4 has no `tailwind.config.js` · pnpm 11
reads settings from `pnpm-workspace.yaml`, **not** `.npmrc`.

