# ADR-0001: TypeScript everywhere, in a pnpm monorepo

- **Status:** accepted
- **Date:** 2026-07-26

## Context

life-manager is built by a solo maintainer, and the overwhelming majority of the code will
be written by AI sessions that share no memory with each other. The system needs a web
client now and native clients later, all talking to one backend.

Two properties therefore matter more than raw language quality:

1. **A single contract shared by client and server.** Duplicated request/response types
   that drift are a bug source no amount of care prevents.
2. **Density of training data.** A fresh session guesses less often, and guesses better,
   in a language and ecosystem it has seen enormously.

## Decision

TypeScript with `strict: true` across the entire stack, in a pnpm workspace monorepo with
Turborepo for task orchestration.

```
apps/web/          Vite React SPA
apps/api/          Fastify server
packages/shared/   Zod schemas + inferred types — imported by both
```

`packages/shared` may not import from either app. Dependencies point inward only.

## Alternatives considered

- **Python + FastAPI for the backend.** Genuinely nicer ergonomics for data work, excellent
  OpenAPI story via Pydantic, and strong AI-assistance coverage. Lost on the contract
  point: it cannot share types with a TypeScript web client. The best available option is
  generating a client from OpenAPI, which is a build step that goes stale and a second
  source of truth. Also splits the repo across two toolchains, two dependency managers, and
  two CI setups — meaningful overhead for one person.
- **Go for the backend.** Better runtime characteristics, trivial deployment, excellent
  concurrency. Same fatal problem with type sharing, plus significantly more code for
  ordinary CRUD. The performance advantage is irrelevant for a personal app.
- **Separate repositories per app.** Standard for teams that deploy independently. Here it
  means the shared contract lives in a published package, and every schema change becomes
  a version-bump-and-release dance across three repos. For one maintainer that is pure
  overhead.
- **Nx instead of Turborepo.** More powerful, considerably more configuration. Three
  packages do not need a build graph that sophisticated.
- **pnpm workspaces with no task runner.** Viable, and honestly close. Turborepo earns its
  place through caching and one-command `pnpm test` across packages.

## Consequences

**Good:** One language, one toolchain, one `pnpm install`. Zod schemas in
`packages/shared` are the single contract source
([ADR-0004](0004-zod-single-contract-source.md)) — a schema change breaks the build on
both sides immediately rather than failing in production. A single session can make a
full-stack change atomically.

**Bad:** Node's runtime is slower and heavier than Go's; irrelevant at this scale but real.
TypeScript's type system offers no runtime guarantees, which is precisely why Zod
validation at the edge is mandatory. Monorepo tooling has its own failure modes that a
future session will occasionally have to debug.

**Revisit if:** a domain needs genuine computational work (large-scale document processing,
ML) — that belongs in a separate service in whatever language suits, called over HTTP,
not in a rewrite of the API.
