# life-manager

Personal life-management app: documents, physical assets, money, people, notes, and
(eventually) a secrets/password vault. Built incrementally, almost entirely across
separate AI-agent coding sessions — this file exists so a new session can orient
itself without scanning the whole repo.

## Status

Pre-code. Only documentation and architecture decisions exist so far. No app code,
no dependencies, no CI. Do not assume any tooling beyond what's listed below exists
yet — check before relying on it.

## Tech stack (decided, not yet scaffolded)

| Layer | Choice |
|---|---|
| Web client | Next.js + TypeScript, PWA (installable, offline-cached shell) |
| Backend API | Fastify + TypeScript, versioned REST (`/api/v1/...`), OpenAPI contract |
| Database | Postgres, hosted via Supabase |
| Auth | Supabase Auth (JWT), verified by the backend only |
| File storage | Supabase Storage, private buckets, accessed only via the backend |
| Repo layout | Monorepo: `apps/web`, `apps/api`, `packages/shared` (not yet created) |

Frontend and backend are fully decoupled: the web app (and any future mobile app)
talks only to the Fastify API over HTTP. Nothing outside `apps/api` talks to Postgres
or Supabase directly.

## Repo map

- [`docs/architecture.md`](docs/architecture.md) — system-level view of how the
  pieces above fit together
- [`docs/glossary.md`](docs/glossary.md) — shared vocabulary used across domain docs
- [`docs/decisions/`](docs/decisions/) — ADRs: the *why* behind each architectural
  choice. Read the relevant ADR before changing something it covers.
- [`docs/domains/`](docs/domains/) — one file per life domain (entity model,
  business rules, API surface). Working on a domain? Read its doc first; you
  shouldn't need to read unrelated domains' docs or code.

## Conventions

Not yet established — no lint config, test framework, or CI exists yet. These will
be added when `apps/`/`packages/` are scaffolded and should be documented here at
that point. Don't assume a testing or linting setup is in place until this section
says otherwise.

## Working agreements

- Product is pre-v1 and single-maintainer during development: schema changes may
  reset the dev database freely (see
  [`docs/decisions/0005-pre-v1-no-migration-discipline.md`](docs/decisions/0005-pre-v1-no-migration-discipline.md)).
- Multi-user data isolation is a day-one requirement even though only one person
  uses the app during development (see
  [`docs/decisions/0003-multiuser-from-day-one.md`](docs/decisions/0003-multiuser-from-day-one.md)).
- When you make a new architectural decision, add an ADR under `docs/decisions/`
  rather than only explaining it in a commit message or chat — chat and commit
  history are not visible to future sessions the way this repo's files are.
