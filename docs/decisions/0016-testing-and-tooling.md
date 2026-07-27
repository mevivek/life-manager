# ADR-0016: Testing and tooling — Vitest, Playwright, Biome

- **Status:** accepted
- **Date:** 2026-07-26

## Context

For a codebase written mostly by AI sessions with no shared memory, tests serve a purpose
beyond catching regressions: **they are the only mechanism that stops a future session from
silently breaking an invariant it never read about.** A session that misses the space-filter
rule in [conventions/code.md](../conventions/code.md) will be caught by a test, or not at
all.

That reframes what matters in the tooling: fast feedback, low configuration surface, and
tests that run against something real enough to catch the bugs that actually occur.

## Decision

| Concern | Tool |
|---|---|
| Unit + integration, both packages | **Vitest** |
| API HTTP-level tests | Vitest + Fastify `app.inject()` |
| API test database | **Real Postgres** — a Neon branch or Testcontainers |
| Web component tests | Vitest + Testing Library + **MSW** |
| End-to-end | **Playwright** |
| Lint + format | **Biome** |
| Types | TypeScript `strict` + `noUncheckedIndexedAccess` |
| CI | GitHub Actions — typecheck → lint → test → build |

Full guidance on what to test at which layer is in
[conventions/testing.md](../conventions/testing.md). Two decisions there are load-bearing
enough to record here:

**API integration tests run against a real Postgres, not a mock.** Most of what can break
in this system is database behavior — the space filter, soft deletes, cascades, `tsvector`
search, JSONB validation, transaction boundaries. A mocked database tests the mock.
Neon branching and Testcontainers both make a real database cheap enough that there is no
excuse.

**Every endpoint gets a cross-space isolation test.** Two users, two spaces, one attempts to
read the other's record, expect `404`. This is mandatory, and it is the single highest-value
test in the codebase — it directly guards
[ADR-0006](0006-space-based-ownership.md).

**No coverage threshold.** A percentage target produces tests written to satisfy the
number. One isolation test is worth twenty points of coverage over trivial mappers.

## Alternatives considered

- **Jest instead of Vitest.** More established, larger ecosystem, far more training-data
  coverage. Rejected on fit: Vite is already the web build tool
  ([ADR-0003](0003-vite-spa-pwa-over-nextjs.md)), so Vitest shares its config and transform
  pipeline instead of duplicating them, it is substantially faster, and it handles ESM and
  TypeScript without the configuration that makes Jest setups fragile. One runner across
  both packages also means one thing to learn.
- **Node's built-in test runner.** Zero dependencies, genuinely good now. Rejected: weaker
  watch mode and mocking, and no shared configuration with the web build.
- **Mocked database for API tests.** Much faster and no infrastructure. Rejected on the
  reasoning above — it would not catch a single one of the bugs this project is most likely
  to have.
- **Cypress instead of Playwright.** Comparable. Playwright wins on speed, on multi-browser
  support without extra setup, and on a better API for the auth-then-act flows that dominate
  here.
- **ESLint + Prettier instead of Biome.** The standard pairing, with a far larger plugin
  ecosystem and much more training-data coverage — a real cost, honestly weighed. Biome wins
  on being a single fast binary with one configuration file. Two tools with overlapping
  responsibilities, a flat-config migration, and plugin version drift is exactly the kind of
  setup a fresh session misconfigures. Fewer moving parts matters more here than plugin
  breadth.
- **No linter, formatter only.** Rejected: lint rules catch real bugs (floating promises,
  unhandled rejections, `any` creeping in) that TypeScript alone does not.

## Consequences

**Good:** One test runner, one lint/format binary, one configuration style across the
monorepo. Fast feedback keeps tests actually run. Real-database tests catch the class of bug
this architecture is most exposed to. The isolation test makes the tenant boundary
executable rather than aspirational.

**Bad:** Integration tests need a Postgres available, so CI and local setup are more
involved than pure unit tests, and they are seconds rather than milliseconds. Biome's
ecosystem is smaller than ESLint's — a needed rule may not exist. Vitest and Biome both have
less training-data coverage than Jest and ESLint, so a session may occasionally need their
docs.

**Standing rule, worth repeating because it is the one most likely to be violated:** never
weaken an assertion or delete a test to get a green build. A failing test is information.
If it is genuinely wrong, fix it deliberately and say so in the commit message.

**Revisit if:** integration tests become slow enough that sessions start skipping them. The
fix is better parallelism and fixtures, not mocking the database.
