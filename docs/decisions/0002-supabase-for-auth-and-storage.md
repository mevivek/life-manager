# 0002 — Supabase scoped to Auth and Storage only

## Context

A managed backend was wanted to avoid running/patching our own auth and file
storage infrastructure for a solo hobby project, without giving up the decoupled
architecture from [0001](0001-decoupled-monorepo-architecture.md).

## Decision

Supabase is used narrowly for two things:
- **Auth** — signup, login, password reset, JWT issuance. Clients talk to Supabase
  Auth directly to obtain a token; the backend verifies that token on every request
  but does not proxy login itself.
- **Storage** — private buckets for file attachments (scanned documents, photos).
  Only `apps/api` holds Storage credentials; clients never get direct bucket access,
  only short-lived signed URLs issued by the backend when needed.

Postgres (also hosted by Supabase) is accessed exclusively by `apps/api`. Clients
never receive a Supabase DB connection string or use the Supabase JS client for data
access — only `@supabase/supabase-js` usage in the codebase should be inside
`apps/api`.

## Consequences

- Supabase could be swapped out later (self-hosted Postgres + a different auth
  provider) without touching client code, since clients only know the backend's
  REST contract plus Auth's login endpoint.
- Row Level Security (RLS) is still enabled on all tables as defense-in-depth, but
  is not the primary authorization mechanism — see
  [0003](0003-multiuser-from-day-one.md).
- Slight duplication of "who is this user" logic (Supabase Auth issues the identity,
  backend re-derives authorization from it) — accepted as the cost of keeping the
  backend as the real trust boundary.
