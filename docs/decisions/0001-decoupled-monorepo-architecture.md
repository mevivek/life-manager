# 0001 — Decoupled monorepo architecture

## Context

The app must eventually support multiple clients (web now, Android/iOS possibly
later) without rebuilding backend logic per client. Talking to Supabase directly
from the web frontend (the initial plan) would tie every client to Supabase's
client SDK and scatter business logic into frontend code, making a second client
expensive to add.

## Decision

- Monorepo with `apps/web` (Next.js PWA), `apps/api` (Fastify backend), and
  `packages/shared` (TypeScript types + validation schemas used by both).
- `apps/web` talks *only* to `apps/api` over HTTP (plus Supabase Auth directly for
  login/signup — see
  [0002](0002-supabase-for-auth-and-storage.md)). It never touches Postgres or
  Supabase Storage.
- `apps/api` is the only thing with database/storage credentials and owns all
  business logic (validation, reminders, category rules, per-user authorization).
- The API is versioned (`/api/v1/...`) and described by an OpenAPI spec, which is
  the contract any future client codegens against.
- Backend framework: **Fastify** (chosen over NestJS) — lighter weight, less
  boilerplate/fewer concepts to track across many independent AI-agent sessions
  working on the codebase over time. Framework choice is not load-bearing for
  clients since they only depend on the OpenAPI contract, not the framework.

## Consequences

- More upfront structure than "just call Supabase from the frontend," but adding a
  mobile client later means implementing against the OpenAPI spec, not rewriting
  business logic.
- `packages/shared` becomes the single source of truth for entity shapes — reused
  by both apps instead of duplicated/drifting.
- The Vault (Tier B) subsystem, when built, can put its client-side encryption logic
  in `packages/shared` too, so mobile doesn't reimplement crypto from scratch.
- Slightly more moving parts for a solo hobby project (two running services during
  development instead of one), accepted as the cost of the decoupling goal.
