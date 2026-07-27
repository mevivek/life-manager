# Architecture decisions

One line per ADR, so you can find the right one without opening seventeen files.

**How ADRs work here:** each records one decision, its context, its **rejected
alternatives**, and its consequences. The rejected-alternatives section is the load-bearing
part — it is what stops a future session re-proposing an option that was already ruled out
for a reason that still holds.

ADRs are **superseded, never edited in place.** If a decision changes, write a new ADR and
mark the old one superseded. Rationale: [ADR-0015](0015-docs-as-orientation.md).

Template: [0000-adr-template.md](0000-adr-template.md).

---

## Index

| # | Decision | Status | In one line |
|---|---|---|---|
| [0001](0001-typescript-monorepo.md) | TypeScript monorepo | accepted | One language, pnpm workspaces + Turborepo; shared Zod contract is the reason |
| [0002](0002-api-first-decoupling.md) | API-first decoupling | accepted | Every client is a plain HTTP consumer; only `apps/api` touches the database |
| [0003](0003-vite-spa-pwa-over-nextjs.md) | Vite SPA, not Next.js | accepted | SSR is unusable under ADR-0002 and tempts sessions to break it |
| [0004](0004-zod-single-contract-source.md) | Zod as the single contract | accepted | One schema → validation + types + OpenAPI + form validation |
| [0005](0005-postgres-neon-drizzle.md) | Postgres on Neon, Drizzle | accepted | JSONB, full-text, transactions; branching makes resets free |
| [0006](0006-space-based-ownership.md) | Space-based ownership | accepted | Records belong to spaces, not users — family sharing is near-term |
| [0007](0007-better-auth-self-hosted.md) | Better Auth, self-hosted | accepted | Users in our own Postgres; passkeys and vault key material need it |
| [0008](0008-object-storage-r2.md) | Cloudflare R2, presigned URLs | accepted | Zero egress; the API chooses object keys, bytes never transit it |
| [0009](0009-sensitivity-tiers.md) | Sensitivity tiers | accepted | No app-level encryption for ordinary data; that's what keeps OCR and search possible |
| [0010](0010-vault-key-hierarchy.md) | Vault key hierarchy | accepted | Argon2id → keypair → space key → per-item DEK, plus a recovery code |
| [0011](0011-pre-v1-schema-resets.md) | Pre-v1 schema resets | accepted | Reset the dev database rather than migrate it — **until M3** |
| [0012](0012-pg-boss-background-jobs.md) | pg-boss for jobs | accepted | Queue on the existing Postgres; jobs enqueue transactionally. No Redis |
| [0013](0013-read-only-offline-v1.md) | Read-only offline in v1 | accepted | Cache reads; writes need connectivity. Offline writes are their own project |
| [0014](0014-hosting-topology.md) | Hosting topology | accepted | Cloudflare Pages + Fly.io + Neon + R2; free except a few dollars for the API |
| [0015](0015-docs-as-orientation.md) | Docs as orientation | accepted | Documentation is a routing system for sessions with no memory |
| [0016](0016-testing-and-tooling.md) | Testing and tooling | accepted | Vitest against real Postgres, Playwright, Biome; a cross-space test per endpoint |
| [0017](0017-product-brain.md) | Product brain | accepted | Product direction is a living doc; AI proposes, the human decides scope |

---

## By topic

**Deciding how to build something**
0001 language · 0003 web client · 0004 contract · 0005 database · 0012 jobs · 0016 tests

**Touching auth, ownership, or crypto** — read [security-model.md](../security-model.md)
first
0002 boundaries · 0006 ownership · 0007 auth · 0009 tiers · 0010 vault keys

**Changing the schema**
0005 Drizzle · 0006 `space_id` on everything · 0011 reset-don't-migrate

**Files and storage**
0008 R2 and presigned URLs · 0009 not encrypted

**Deployment and cost**
0014 hosting · 0005 Neon · 0008 R2

**Deciding what to build**
0017 product brain · 0015 documentation structure

---

## Writing a new ADR

1. Copy [0000-adr-template.md](0000-adr-template.md) to `NNNN-short-kebab-title.md`.
2. Fill in every section. **Spend the effort on "Alternatives considered"** — it is the
   section a future session will actually need.
3. Add a row above, and a topic entry if it fits one.
4. If it replaces an existing decision, set `Superseded by` on the old ADR and `Supersedes`
   on the new one. Do not delete or rewrite the old one.

Write an ADR when a choice constrains future work, would be expensive to reverse, or has a
plausible alternative someone will suggest again. Not for routine implementation choices —
those belong in [conventions/](../conventions/).
