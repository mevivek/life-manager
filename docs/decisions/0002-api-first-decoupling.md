# ADR-0002: API-first decoupling — clients are pure HTTP consumers

- **Status:** accepted
- **Date:** 2026-07-26
- **Amended:** 2026-07-30 — one named exemption to invariant 1, for the deploy verifier
  (see § Amendment below). The invariant itself is unchanged.

## Context

The web PWA is the first client, not the only one. Android and iOS clients are expected,
and the stated requirement is that they be plug-and-play — buildable without server-side
changes.

The common failure mode is subtle: a web-first architecture accumulates logic in the web
tier — a validation rule here, a data-shaping step there, an auth flow that assumes cookies
and a browser. None of it looks like a mistake at the time. By the time the second client
is written, that logic has to be either duplicated or extracted, and extraction is a
rewrite.

## Decision

**The API is the entire product surface. Every client is a plain HTTP consumer with no
privileged access.**

Concretely, four invariants:

1. **Only `apps/api` holds a database URL or an R2 credential.** No client, build step, or
   script outside it may connect to Postgres or R2.
2. **No business logic in a client.** Client-side validation exists for UX only; the
   server is authoritative. A rule that exists only in the web app does not exist —
   Android will not have it.
3. **No client-specific endpoints.** No `/api/v1/web/...`. If the web app needs a
   different shape, that is a query parameter or a general-purpose endpoint, not a
   privileged one.
4. **Auth works for both transports.** Cookie sessions for the browser, bearer tokens for
   native, resolving to the same `ActorContext`
   ([security-model.md](../security-model.md) §2).

The OpenAPI 3.1 document generated from the Zod schemas
([ADR-0004](0004-zod-single-contract-source.md)) is the contract. A future mobile
developer — or session — should be able to build a client from it alone.

## Alternatives considered

- **Backend-for-frontend (BFF).** A server tier per client, shaping responses for each.
  Legitimate at scale, where clients diverge sharply and separate teams own them. Here it
  means writing and hosting a second backend before the second client even exists.
- **Supabase-style direct database access from the client, with RLS.** Very fast to build:
  skip the API entirely, let clients query Postgres with row-level security enforcing
  isolation. Rejected because it puts business rules in database policies, makes every
  client responsible for query correctness, hard-couples every client to the schema, and
  turns each new client into a new attack surface against the database. It also makes the
  future vault's key handling substantially harder to reason about.
- **GraphQL.** Solves real over-fetching problems for diverse clients. Costs a schema
  layer, resolver plumbing, and query-complexity defenses. With one maintainer and a
  handful of resources, REST plus a generated OpenAPI spec gives more of the benefit for
  much less machinery.
- **tRPC.** Excellent end-to-end type safety in a TypeScript monorepo, and tempting given
  [ADR-0001](0001-typescript-monorepo.md). Rejected specifically because it is
  TypeScript-only: a Kotlin or Swift client cannot consume it. It optimizes for the case
  this decision exists to avoid.

## Consequences

**Good:** A native client is a genuinely additive project — no server work. The contract is
inspectable and testable independently of any UI. Testing the API tests the product. The
security boundary is one process, which makes it reviewable.

**Bad:** More upfront ceremony than a coupled full-stack framework — every feature needs an
endpoint, schemas, and a client call. Some over-fetching, since responses aren't tailored
per screen. No SSR, so the first paint waits on an API round trip
([ADR-0003](0003-vite-spa-pwa-over-nextjs.md)).

**Revisit if:** never, realistically. This is the load-bearing constraint the rest of the
architecture rests on. If it stops holding, most other ADRs need re-examining too.

## Amendment, 2026-07-30: the deploy verifier holds a database credential

A review found that `scripts/verify-deployment.mjs` opens a direct connection to production
Postgres from outside `apps/api` — it reads `DATABASE_URL_UNPOOLED` (from the real environment,
or failing that from `apps/api/.env`) and runs a `pg` client to delete the rows its own
round-trip checks created. Invariant 1 above says *"No client, build step, or script outside
it may connect to Postgres or R2"*, with no exemption clause. So the invariant was being
violated by a committed script, and had been for as long as the verifier has had a cleanup step.

**The decision: carve the exemption here, explicitly, rather than pretend or quietly widen the
rule.** An invariant that the codebase visibly breaks teaches the next session that all twelve
are negotiable, which is a worse outcome than a narrow, argued exception.

**The exemption, and its limits.** `scripts/verify-deployment.mjs` may hold a read/delete
database credential, because:

- It is **not a client and not a build step.** Nothing it does ships, and no user-facing code
  path runs it. It is an operator tool that answers "is the thing I just deployed actually
  working", which is a question no client is allowed to care about.
- Its database access exists **only to clean up after itself.** The verifier writes real rows
  through the real API to prove the presign → PUT → confirm path works end to end; without the
  cleanup, every run would leave litter in the maintainer's space. Routing that through a new
  API endpoint would mean shipping a production *delete* endpoint whose only purpose is
  testing — a bigger hole than the one being closed.
- The credential is **optional**, so a machine that has never run the API locally can still run
  every check; only the tidy-up is skipped.

**What this does NOT license.** No other script, no build step, no client, and no future
verifier variant. If a second script needs the database, that is a new decision, not a
precedent — and the right answer is probably an endpoint. The exemption is for this file, for
cleanup, and nothing else.

**Revisit if:** the cleanup grows into anything that reads or modifies data it did not create,
or if R2 object deletion lands and the same argument gets stretched to cover a storage
credential. Either is a signal the tool has outgrown the exemption.
