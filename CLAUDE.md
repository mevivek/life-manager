# life-manager

Personal life-management app: documents, physical assets, money, people, notes, and eventually a
secrets/password vault. Built incrementally, almost entirely across separate AI-agent sessions.

**This file is a router, not a summary** — so a session orients in one read, then opens only what its
task needs. Capped at 16 KiB, enforced by a test ([§ How to edit this file](#how-to-edit-this-file)).
Full index: [`docs/README.md`](docs/README.md).

---

## Status

**Current position lives in [roadmap.md § Current position](docs/roadmap.md#current-position), and
only there.** Deployment and provisioning status used to be asserted in five files; they disagreed,
and correcting all five was itself the bug (debt D28). Do not restate it here.

**M1 (Documents) and M4 step 1 (the Things API) are built and deployed. M1 is one *observed*
notification short of done** — the daily-scan trigger is proven in production, but no push
notification has been *seen* arriving on the phone.

**The suite size and skip count live in [conventions/testing.md §8](docs/conventions/testing.md),
measured and dated — and nowhere else.** A count was asserted in both files and they disagreed; the
same duplication that made deployment status wrong in five places (D28).

**Re-measure rather than trusting that** — a count here has been wrong three times, most recently by
17 tests. How to run the DB-backed suites without Docker, the four details that fail *silently*, the
four known-flaky tests, and why a probe of production from this container is **not evidence**:
**[conventions/testing.md §8](docs/conventions/testing.md)** — read it before reporting a number or
diagnosing a deploy.

---

## Start here — next actions

**[roadmap.md § Next actions](docs/roadmap.md).** What is missing is use and observation, not code.
Do not re-derive the list here.

---

## Doing X? Read Y.

One row, one destination. **The rule lives in the target doc, not in this table** — needing the rule
itself here means the routing has failed; fix the routing.

| Task | Read |
|---|---|
| **Auth, ownership, or crypto — anything** | [`security-model.md`](docs/security-model.md) **in full**, first |
| **Documents domain** | [`domains/documents.md`](docs/domains/documents.md) |
| **The Things domain** — a warranty, serial, service date, owned object | [`domains/things.md`](docs/domains/things.md), then [ADR-0029](docs/decisions/0029-the-things-domain.md) |
| **Anything visual** — screen, component, colour, size, headline, copy | [`conventions/design.md`](docs/conventions/design.md); [ADR-0025](docs/decisions/0025-ledger-design-system.md) for *why*. **Render it at 390px in both themes before calling it done** (D64) |
| **Caching, offline, the outbox, a new `useQuery` key** | [ADR-0024](docs/decisions/0024-offline-writes-outbox.md), then `lib/persister.ts` — the allowlist is **opt-in** |
| **Adding/changing a field on a cached response** | debt **D46/D54** — the cache rehydrates **without re-running Zod**, and web and API deploy on **separate triggers** |
| **A route with a `:verb` action** | [`conventions/api.md`](docs/conventions/api.md) §2 — `::` is **registration-only**; a client's URL has ONE colon. Backwards 404'd every photo upload in production |
| **Adding an endpoint / domain / schema change** | the matching [playbook](docs/agent-playbooks/). A mutable column needs `versioned()` (`apps/api/src/db/columns.ts`) |
| **The daily scan, reminders firing, or the `maintenance` endpoint** | [ADR-0028](docs/decisions/0028-external-trigger-for-the-daily-scan.md) |
| **The tab bar, or where a domain lives** | **Three tabs: Now · Everything · You** — [ADR-0032](docs/decisions/0032-one-library-tab.md), superseding ADR-0031's fourth tab. `/library` holds both collections; `All` interleaves them by soonest date. Scope pills are buttons, not navigation; **no filter chips** ([ADR-0033](docs/decisions/0033-handoff-5-the-rest.md)). Before a fourth tab, **measure** ([design.md §8](docs/conventions/design.md)) |
| **Capture / the Add sheet** | [ADR-0030](docs/decisions/0030-capture-as-a-stepped-wizard.md) — six steps, two tracks, **exactly one required field per track** |
| **Deciding what to build, or a technical call** | [`product/brain.md`](docs/product/brain.md). Scope needs a human yes — invariant 12 |
| **Reviewing a milestone** | [`product/review-method.md`](docs/product/review-method.md); the register is [`review.md`](docs/product/review.md) |
| **"Why is it like this?"** | [`decisions/index.md`](docs/decisions/index.md) — 33 ADRs. Don't read them front to back |
| **"Is this missing, or deferred?"** | [debt register](docs/product/review.md#3-debt-register) — **D1–D86**, each with a trigger. Check before "fixing" an apparent gap. **D84/D85 first if a screen the comp draws is missing** — handoff 5's People half and its Google-only sign-in are deliberately unbuilt |
| **Running it locally** | [`README.md`](README.md) § Getting started |
| **Anything else** | [`docs/README.md`](docs/README.md) — the fuller index this file delegates to |

**Baseline is three files: this one, the routing table, and the one doc your task names.** Route to
the rest, don't sweep it ([read budget](docs/README.md#read-budget)).

---

## Invariants

Non-negotiable. Breaking one is a bug even if tests pass. Each links to its reasoning.

1. **Only `apps/api` touches Postgres or R2.** No client, build step, or script outside it holds
   a database URL or storage credential — with one named exemption, the deploy verifier's cleanup
   ([ADR-0002](docs/decisions/0002-api-first-decoupling.md) § Amendment).
2. **Records belong to a *space*, never a user.** Every domain table carries `space_id`.
   ([ADR-0006](docs/decisions/0006-space-based-ownership.md))
3. **Every repository function takes `actor: ActorContext` first** and filters
   `space_id IN actor.spaceIds` and `deleted_at IS NULL`.
   ([conventions/code.md](docs/conventions/code.md) §2)
4. **Cross-space access returns 404, never 403.** A 403 confirms the record exists.
   ([conventions/api.md](docs/conventions/api.md) §3)
5. **No business logic in a client.** Client validation is UX only; the server is authoritative.
   A rule only in the web app does not exist — Android won't have it.
6. **The API chooses every storage object key.** Clients never supply one.
   ([ADR-0008](docs/decisions/0008-object-storage-r2.md))
7. **No application-level encryption of ordinary data.** Vault-only — that is what keeps OCR,
   search and reminders possible. Document identifiers are stored in *plaintext*
   ([ADR-0026](docs/decisions/0026-store-the-full-identifier.md)), so **no copy may say "encrypted"**
   (D44). ([ADR-0009](docs/decisions/0009-sensitivity-tiers.md))
8. **Never hand-roll crypto.** Fixed primitives in [security-model.md](docs/security-model.md) §5.
9. **Zod schemas in `packages/shared` are the only contract source.** Never hand-write a type that
   mirrors a schema. ([ADR-0004](docs/decisions/0004-zod-single-contract-source.md))
10. **Never weaken a test to get a green build.**
    ([conventions/testing.md](docs/conventions/testing.md) §5)
11. **No secrets in the repo.** Not in code, docs, commit messages, or `.env` files.
12. **The AI proposes; the human decides product scope.** Nothing reaches the roadmap without an
    explicit yes ([ADR-0017](docs/decisions/0017-product-brain.md)). **Bypassed once** — a whole
    domain went from design handoff to shipped with no backlog entry
    ([idea-backlog.md](docs/product/idea-backlog.md) § Ready).

---

## Stack

TypeScript strict monorepo (pnpm + Turborepo) · Vite React SPA as a PWA · Fastify + Zod →
OpenAPI 3.1 · Postgres 18 on Neon via Drizzle · Better Auth self-hosted · Cloudflare R2 ·
pg-boss for jobs · Vitest + MSW · Biome · Cloudflare Pages + Cloud Run.

**The table — every version, its ADR, and the couplings that force each other — is
[architecture.md §3](docs/architecture.md#3-technology).** It is the only one; this file used to
carry a second and they disagreed. Before proposing a change, read
[`decisions/index.md`](docs/decisions/index.md): Next.js, Supabase, Prisma, Redis, tRPC, GraphQL and
offline-first sync were each evaluated and declined.

---

## Layout

```
apps/web/   src/routes (file routes; `_authed.tsx` guards) · src/features/<domain> ·
            src/components/ui · src/lib (api.ts is the ONE typed client)
apps/api/   src/domains/<d>/<d>.{routes,service,repository,test}.ts · src/db (client,
            columns, schema/, scoped.ts — THE tenant filter) · src/auth · src/jobs ·
            src/lib · src/test · drizzle/ (committed migration SQL)
packages/shared/   Zod schemas + inferred types, imported by both
```

Fuller tree: [architecture.md](docs/architecture.md). Three rules it does not show:

- **Read `apps/api/src/db/scoped.ts` before touching anything space-scoped** — the only place the
  tenant filter is written — plus `db/schema/scoped-columns.ts`.
- **Domain tables live in their domain folder**, and `db/schema/index.ts` is the single barrel
  `drizzle.config.ts` reads, so **a table not re-exported there does not exist** to migrations —
  invisible locally, missing in production; `scripts/check-schema-barrel.mjs` fails the build on it.
  One deliberate exception: `reminders` and `push_subscriptions` live in `documents.schema.ts`
  ([documents.md](docs/domains/documents.md) §10).
- **Nothing in `apps/web` reaches around `lib/api.ts`.**

---

## Conventions

[`docs/conventions/`](docs/conventions/) describes them; these enforce them:

| Enforced by | What |
|---|---|
| `biome.json` | Format + lint; `no-explicit-any`, `noNonNullAssertion`, `noFloatingPromises` are **errors**. **No comments in it** — Biome silently falls back to defaults it cannot deserialise, so one `//` fails every file with nothing naming the cause |
| `tsconfig.base.json` | `strict` + `noUncheckedIndexedAccess`, monorepo-wide |
| `turbo.json` | `pnpm typecheck`, `pnpm build` — ordered so `packages/shared` builds first |
| `vitest.config.ts` (root) | `pnpm test` runs all three packages |
| `apps/web/src/lib/utils.test.ts` | The token/`cn()` coupling — reads `styles.css` **from disk**, so a token forgotten in `utils.ts` fails here. It used to walk the arrays it was checking, and so could not fail |
| `apps/web/src/lib/startup.test.tsx` | `RestoreGate` and the route guard's `networkMode` (D49) |
| `packages/shared/src/contract.test.ts` | Every response field is tolerant of an older server — the web and API deploy separately (D54) |
| `scripts/check-schema-barrel.mjs` | A domain table missing from the barrel |
| `scripts/check-cloudbuild-subs.mjs` | A `$UPPER` token Cloud Build rejects the whole config over — **it cannot be caught in the pipeline**, since a rejected config runs no steps (D82) |
| `cloudbuild.deploy.yaml` | typecheck → lint → test → build → deploy on push. **The real pipeline** — Actions does not run here, and the workflow that claimed to is deleted (D24). Editing it needs a trigger delete-and-recreate (D25) |

`pnpm` settings live in `pnpm-workspace.yaml`, not `.npmrc`.

---

## Working agreements

- **Delegate wide reading to subagents.** Context is a budget; sweeping many files to answer one
  question spends it on material the task never needed. Hand a broad search, audit, or parallel
  bug-hunt to a subagent and keep its *conclusion*, not its file dumps. Give each a **disjoint file
  set** so concurrent edits cannot collide, say whether it may write, and require `file:line` plus
  what it verified. Judge the result yourself — a report is evidence, not a verdict, and can be
  confidently wrong. Two rules learned the hard way: a **unique** Postgres datadir and port per
  agent, and **never commit while an agent is still writing** (a file caught mid-write has already
  shipped a crash here).
- **One domain at a time.** Finish and actually use it first — six shallow domains are worth less
  than one good one ([product/brain.md](docs/product/brain.md) §5).
- **Pre-v1, the dev database may be reset rather than migrated** — until M3
  ([ADR-0011](docs/decisions/0011-pre-v1-schema-resets.md)).
- **Multi-user isolation is a day-one requirement**, even with one user
  ([ADR-0006](docs/decisions/0006-space-based-ownership.md)).
- **A new architectural decision gets an ADR** — a commit message is not visible to the next session.
  ADRs are **superseded, never edited in place** ([ADR-0015](docs/decisions/0015-docs-as-orientation.md) §2).
- **A new product idea goes in [the backlog](docs/product/idea-backlog.md)** with a status, rejections
  included, with the reason. Scope reaching code without a human yes is a process failure (invariant 12).
- **A change that alters an invariant updates the docs in the same commit.**
- **When you assert a count, assert a non-zero one.** `file_count` was 0 for all of M1 because every
  test expected 0 (D33).
- **Docs use the [glossary's](docs/glossary.md) words.** Say *space*, not tenant or org.

---

## How to edit this file

This file grew 23 KB → 42 KB across 24 commits without one ever making it smaller, and came to
contradict itself five times — including about how many tabs the app has, in the routing table a
layout session reads. That is the mechanical cause of sessions "not following the plan": a fresh
session got two answers and followed the one it read last. Three rules, none optional.

1. **Capped at 16 KB; `apps/web/src/lib/docs.test.ts` fails the build above that.** To add, remove.
   The cap is the only thing that forces reconciliation instead of appending.
2. **Route; don't restate.** A war story is a [debt row](docs/product/review.md) with a trigger. A
   rule belongs in its convention doc, a decision in an ADR, status in the
   [roadmap](docs/roadmap.md#current-position). If it reads like a story, it is in the wrong file.
3. **If you contradict a line here, delete that line in the same commit.** Never leave both — every
   one of the five contradictions was an append that did not remove what it replaced.

`docs.test.ts` also checks what prose cannot: that the tab count here matches `TabBar.tsx`, that the
debt range matches the register, and that every debt cited here exists there.
