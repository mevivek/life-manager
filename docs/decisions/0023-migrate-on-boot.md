# ADR-0023: The API applies its own migrations on boot

- **Status:** accepted
- **Date:** 2026-07-28

## Context

**Nothing was applying migrations on deploy.** This was found while preparing to deploy M1, and it
would have shipped an API reporting healthy with five missing tables.

The history is a gap opened by an earlier decision rather than an oversight in any one commit:

- [ADR-0014](0014-hosting-topology.md) chose Fly, and `fly.toml`'s `release_command` ran
  `db:migrate` before each release. That worked.
- [ADR-0021](0021-cloud-run-for-the-api.md) moved the API to Cloud Run. Cloud Run has **no
  equivalent of `release_command`** — a revision either serves or it does not.
- `cloudbuild.deploy.yaml` (the real pipeline, since GitHub Actions never runs here — debt D24) was
  written with `guard → clone → postgres → install → typecheck → lint → test → build → push →
  deploy → verify`. **No migrate step.**
- M0 was unaffected only by luck: its schema had been applied by hand with `db:push` on 2026-07-27,
  so `documents` being absent was the first time it mattered.

Two things made this invisible, and both are worth stating because they are the reason it nearly
shipped:

1. **`GET /api/v1/health` does not touch the database.** The pipeline's own `verify` step curls it
   and would have gone green.
2. **`scripts/verify-deployment.mjs` never exercised a domain endpoint either.** Its 23 checks cover
   auth, cookies and the built bundle — so the post-deploy verifier would also have gone green.

That is the same failure shape as debt D23 (a Pages build with `VITE_API_URL` unset): *looks
perfectly healthy, is broken*.

### The constraint that decided this

**The fix had to ship inside the container image.** Adding a migrate step to
`cloudbuild.deploy.yaml` changes nothing until the new config is pushed to the Cloud Build trigger,
and that trigger holds an **inline copy** which `gcloud builds triggers update webhook` cannot
replace — it must be deleted and recreated (debt **D25**). Editing that file without `gcloud` access
would have produced a commit that *looks* like the fix while the stale pipeline kept running, which
is worse than not fixing it.

## Decision

**`server.ts` applies the committed migrations before it starts listening**, on the unpooled
connection, under a Postgres session advisory lock.

```
main()
  └─ applyMigrations()   ← blocks until done, or exits the process
  └─ buildApp()
  └─ app.listen()
```

Four properties, each deliberate:

- **On by default.** `SKIP_MIGRATIONS_ON_BOOT` exists as an escape hatch and defaults to *off*. A
  variable that had to be *set* for deploys to work would reintroduce exactly the manual `gcloud`
  step that closing debt D22 removed.
- **Under an advisory lock.** Cloud Run runs `--max-instances=3`, so two cold starts can call this
  simultaneously. Without a lock both read an empty `__drizzle_migrations`, both apply the same
  `create table`, and the loser dies with `relation already exists`. **Measured, not assumed:** the
  test in `migrations.test.ts` migrates a *fresh* database from three callers at once and fails
  without the lock.
- **Session-level, not transaction-level.** Drizzle's migrator opens its own transaction, so
  `pg_advisory_xact_lock` would be released when *its* transaction commits rather than when the
  whole run finishes.
- **On the unpooled URL.** DDL takes locks that do not belong in a transaction-pooled session, and a
  session-level lock taken through PgBouncer can be released on a different backend than took it.

`lock_timeout` is 60s, so a genuinely stuck migration fails the boot with a clear error rather than
hanging until Cloud Run's start deadline reports something vaguer.

**Failing here is the correct behaviour.** The process exits, the revision never becomes healthy,
and Cloud Run keeps serving the previous one. A bad migration stops a deploy instead of
half-applying and serving.

`scripts/verify-deployment.mjs` also gains a documents round-trip, so the *next* time something
like this happens the verifier catches it rather than reporting 23 green checks against a broken
API.

## Alternatives considered

- **A migrate step in `cloudbuild.deploy.yaml`.** The textbook answer, and where this belongs in
  principle: migrations are a deploy concern, not a runtime one. **Rejected as currently
  unreachable** — debt D25 means the edit would be inert until the trigger is deleted and recreated
  with `gcloud`, which no browser-only or agent session can do. Worth revisiting the moment the
  repository is properly connected to Cloud Build, which also closes D25.
- **A separate Cloud Run Job, run before the deploy.** Clean separation and the "right" cloud-native
  shape. Rejected for the same reason plus more: it needs a second deployable, its own service
  account and its own invocation from the pipeline — all of it `gcloud` work, to solve a problem one
  `await` solves.
- **Keep applying migrations by hand** (`pnpm --filter api db:push`) before each deploy. This is
  what M0 effectively did. Rejected because it contradicts an explicit design constraint in
  `README.md` § Deploying — *"a deploy that only works from one machine's terminal means no AI
  session without shell access can ship anything"* — which is the same argument that made debt D22
  worth closing. A schema change that requires a laptop is a deploy that requires a laptop.
- **Migrate lazily on first request.** Rejected: it makes the first request after a deploy slow and
  occasionally fail, and it means a broken migration surfaces to a user rather than to the deploy.
- **`drizzle-kit push` at boot instead of the committed migration files.** Rejected firmly. `push`
  diffs the live schema against the code and invents the DDL, which is fine pre-v1 against a
  throwaway database ([ADR-0011](0011-pre-v1-schema-resets.md)) and is *not* something to point at a
  database holding real documents. The committed files are reviewable and are exercised by every
  `pnpm test` run.

## Consequences

**Good:** deploying a schema change now needs nothing but a push, which is the property this project
keeps paying for on purpose. The migration files are already in the image (the Dockerfile copies
them), so nothing new ships. `pnpm test` exercised the same `migrate()` on every run already, so the
code path is not new either — only its caller is.

**Bad, and worth stating honestly:**

- **Boot is now coupled to the database.** An unreachable Neon means the API will not start at all,
  where previously it would have started and failed per-request. Arguably better — it fails at deploy
  rather than in front of a user — but it is a real change in failure mode, and scale-to-zero means
  boot happens constantly rather than once.
- **Cold starts pay a round trip.** A no-op migration on an already-current database is one
  connection, one lock, one `select` from `__drizzle_migrations`. Small, but on the critical path of
  every scale-from-zero request.
- **Migrations are no longer separable from the deploy.** You cannot deploy the code and migrate
  later, or roll back the code without thinking about the schema. Pre-v1 with additive migrations
  this is fine; it is a real constraint from M3 onward, when
  [ADR-0011](0011-pre-v1-schema-resets.md)'s reset freedom ends.
- **This is the runtime doing a deploy-time job**, and it should be said plainly rather than
  rationalised: the reason is D25, not architecture.

**Revisit if:** the repository gets connected to Cloud Build properly (then move this into the
pipeline as a step gated before `deploy`, and close D25 at the same time), or the cold-start cost
ever shows up in practice.
