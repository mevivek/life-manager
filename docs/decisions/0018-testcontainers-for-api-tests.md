# ADR-0018: Testcontainers for API tests, with a `TEST_DATABASE_URL` escape hatch

- **Status:** accepted
- **Date:** 2026-07-27
- **Supersedes:** —
- **Superseded by:** —

## Context

[ADR-0016](0016-testing-and-tooling.md) and
[conventions/testing.md](../conventions/testing.md) §1 both require API integration tests to run
against **a real Postgres**, because most of what can go wrong in this codebase — the space
filter, soft deletes, cascades, partial unique indexes, later `tsvector` search and JSONB
validation — is database behaviour. A mocked database tests the mock.

Both documents then say "a Neon branch or a Testcontainers Postgres; either is fine" and leave
the choice open. Leaving it open has a cost: every session that writes a test has to decide
again, and the first one to pick wrongly makes the suite slow enough that later sessions start
skipping it — which ADR-0016 names as its own stated failure mode.

Two further constraints appeared while implementing M0:

- **The maintainer's machine has no Docker.** Making Docker a hard prerequisite means a fresh
  clone cannot get a green `pnpm test` until Docker Desktop is installed and running.
- **CI runners already provide Postgres** as a service container, with no credential.

## Decision

**Testcontainers is the default. `TEST_DATABASE_URL` overrides it. Absence of both skips the
database suites rather than failing — except in CI, where it fails.**

Concretely, `apps/api/src/test/global-setup.ts` resolves a database in this order:

1. **`TEST_DATABASE_URL` is set** → use that server. No Docker needed.
2. **otherwise** → start a `postgres:17-alpine` Testcontainer for the run, torn down after.
3. **neither works** → `provide('databaseUrl', null)`. `describeDb` skips the database suites by
   name, every unit and HTTP test still runs, and a boxed warning names both fixes.
4. **neither works and `CI=true`** → throw. A green CI run that silently tested nothing is worse
   than a red one.

Each Vitest worker creates and migrates its **own** database (`<base>_w<workerId>`) on the chosen
server. Isolation within a worker is `truncate` in `beforeEach`. This is what makes
[conventions/testing.md](../conventions/testing.md) §5's "any order and in parallel" true at the
same time as truncation-based cleanup — on a single shared database, one file's truncate deletes
another file's fixtures mid-test, and the failure is intermittent and looks like flaky auth.

Migrations are applied from the **committed migration files**, not `drizzle-kit push`. That
exercises the files [ADR-0011](0011-pre-v1-schema-resets.md) tells us to keep, on every test run.

## Alternatives considered

- **A Neon branch per run.** Rejected as the *default*, on four counts. It is a network call on
  every query, which [conventions/testing.md](../conventions/testing.md) §5 forbids outright. It
  needs a live credential wherever tests run, including CI — and debt D5 records that there is no
  credential-rotation procedure, so an extra long-lived secret is a real cost. Branch creation
  per worker is slow and rate-limited, while sharing one branch across workers reintroduces the
  shared mutable state §5 forbids. And debt D8 already worries about Neon's free compute hours;
  waking the database on every `pnpm test` makes an unquantified concern worse. Neon branching
  keeps its value elsewhere: the ADR-0011 reset-and-verify loop, and the M3 migration rehearsal.
- **Testcontainers with no escape hatch.** The plan's original shape. Rejected once it became
  clear the maintainer's machine has no Docker: it would mean M0's own tests could not be run
  by the person who owns the project, and "install Docker Desktop first" is how a suite becomes
  optional.
- **Failing hard when no database is present.** Honest, and tempting. Rejected because the
  practical result is that `pnpm test` is red by default on a new machine, which trains everyone
  to ignore the result. The CI branch of the decision recovers the strictness where it actually
  matters, and a skipped suite is visibly named in the output rather than absent.
- **Mocking the database (pg-mem, or a repository-level fake).** Rejected by
  [ADR-0016](0016-testing-and-tooling.md) already; restated because it will be suggested again.
  The partial unique index behind `ensurePersonalSpace` and the `scoped()` filter are precisely
  the things a fake would not reproduce, and they are the two things most worth testing.
- **One shared database with `fileParallelism: false`.** Simpler than per-worker databases, and
  it does fix the cross-file truncation problem. Rejected because it trades away parallelism
  permanently for about twenty lines, and the API suite will only grow.

## Consequences

**Good:** `pnpm test` works on a machine with Docker, on a machine with any throwaway Postgres,
and degrades visibly rather than mysteriously on a machine with neither. CI needs no secret at
all. Test databases are genuinely disposable, so tests can `truncate` freely. The migration files
are executed on every run instead of for the first time on deploy day.

**Bad:** Two code paths in the harness instead of one, and the `TEST_DATABASE_URL` path leaves
`*_w1`, `*_w2`… databases behind on that server — so it must point at something disposable, which
`.env.example` says. Per-worker database creation adds roughly a second to a cold run. And the
skip path means a careless reader can believe the API is tested when, on their machine, it is not;
the boxed warning exists to make that hard.

**Revisit if:** the API suite gets slow enough that a session would skip it (then look at reusing
one container across runs), or a Postgres feature we depend on turns out to differ between the
`postgres:17-alpine` image and Neon (then the Neon branch becomes the default and Testcontainers
the fallback, which is this decision inverted rather than replaced).
