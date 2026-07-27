# ADR-0005: Postgres on Neon, accessed through Drizzle ORM

- **Status:** accepted
- **Date:** 2026-07-26

## Context

The data model spans several domains with different shapes: documents with type-varying
attributes, money with exact decimal arithmetic, people with relationships, notes with
full-text search. Requirements that follow from the rest of the design:

- Flexible per-type attributes without a wide table of nullable columns
- Full-text search across documents, and eventually semantic search
- Real transactions — a document plus its files plus its reminders must commit atomically
- A background job queue ([ADR-0012](0012-pg-boss-background-jobs.md))
- Free-tier hosting, with frequent full database resets pre-v1
  ([ADR-0011](0011-pre-v1-schema-resets.md))

## Decision

**Postgres, hosted on Neon, accessed exclusively through Drizzle ORM.**

> **Version, corrected 2026-07-27.** This ADR originally specified Postgres 17. The dev branch
> provisioned at M0 reports **PostgreSQL 18.4** — Neon's default moved on between this decision
> and the scaffold. Nothing here depends on 17 specifically; every feature relied on below has
> been in Postgres for several major versions. **Do not pin a major version in this ADR** — take
> Neon's default and record the observed version in `CLAUDE.md`'s stack table, which is checked
> against reality at each review ([review.md](../product/review.md) lens 3).

Postgres because it covers every requirement above natively: `jsonb` for `custom_attrs`,
generated `tsvector` columns with GIN indexes for search, `numeric` for money, `pgvector`
available later for semantic search, and a job queue that can share the same transaction
as the write that enqueued it.

Neon because its free tier fits this project unusually well: scale-to-zero (a single-user
app is idle almost always), instant database branching, and 100 projects. Branching in
particular makes the pre-v1 reset-freely policy operationally trivial — branch, reset,
verify, discard, with the main branch untouched.

Drizzle because it is SQL-first: the query builder maps closely onto the SQL it generates,
schema definitions are plain TypeScript, and there is no separate DSL, codegen step, or
engine binary.

## Alternatives considered

**Database:**

- **SQLite / Turso / LiteFS.** Genuinely appealing for a personal app — trivial ops, very
  fast, cheap. Rejected on capability: no `jsonb` operators of Postgres's quality, much
  weaker full-text search, no `numeric` type for money, no pgvector, and a job queue would
  need separate infrastructure. Also complicates the multi-user story if this ever goes
  public.
- **MongoDB.** The flexible-attributes argument is real, but it is the *only* argument, and
  `jsonb` already answers it inside a relational database. Loses transactions across
  collections, loses relational integrity between spaces and their records — which is
  exactly the constraint [ADR-0006](0006-space-based-ownership.md) depends on.

**Hosting:**

- **Supabase.** Postgres plus auth, storage, and realtime in one product — the fastest path
  to a working app, and a serious contender. Rejected for two reasons. First, its natural
  usage pattern is clients talking to Postgres directly with RLS, which is exactly what
  [ADR-0002](0002-api-first-decoupling.md) forbids; adopting Supabase means constantly
  swimming against its grain and hoping no future session takes the shortcut. Second, its
  free tier pauses projects after 7 days of inactivity, and a personal app *is* often idle
  for a week. Its bundled auth and storage are also weaker fits than the dedicated choices
  in [ADR-0007](0007-better-auth-self-hosted.md) and
  [ADR-0008](0008-object-storage-r2.md).
- **Railway / Render / Fly Postgres.** Fine managed Postgres, but no branching and no
  scale-to-zero, so an idle personal database costs money continuously.
- **Self-hosted Postgres on a VPS.** Cheapest at scale, full control. Rejected: backups,
  patching, TLS, and uptime become the solo maintainer's job, which is the wrong place to
  spend the limited time this project gets.

**ORM:**

- **Prisma.** Better-known, excellent DX, arguably the most legible schema format for an AI
  session. Rejected because its schema DSL is a second language with its own codegen step
  that goes stale, its query engine is a separate binary complicating deployment, and it
  fights precisely the Postgres features this design leans on — `jsonb` operators,
  generated `tsvector` columns, and row-level security all require raw-SQL escape hatches.
  Drizzle reaches them natively.
- **Kysely.** Excellent typed query builder, very close call. Drizzle wins on including
  schema definitions and migrations in the same tool; Kysely needs a separate migration
  story.
- **Raw SQL with a thin client.** Maximum control, no abstraction to learn. Rejected
  because typed results and compile-time schema checking matter more here — a fresh session
  mistyping a column name should fail at build time, not at runtime.

## Consequences

**Good:** One database serves relational data, flexible attributes, full-text search, and
the job queue — no additional infrastructure. Drizzle's SQL-first shape means a session that
knows SQL can read the queries without learning an abstraction. Neon branching makes
schema experiments genuinely free.

**Bad:** Neon's scale-to-zero means a cold start of a few hundred milliseconds on the first
request after idle — noticeable on a personal app opened once a day. Drizzle is younger
than Prisma with a smaller ecosystem and less training-data coverage, so a session may need
to consult its docs. Serverless Postgres connection pooling needs care; use Neon's pooled
connection string.

**Revisit if:** cold starts become annoying in daily use — the fix is a paid Neon tier with
an always-on compute, not a different database.
