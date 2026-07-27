# ADR-0006: Space-based ownership from day one

- **Status:** accepted
- **Date:** 2026-07-26

## Context

Multi-user isolation is a day-one requirement even though only one person uses the app
during development. Separately, **family sharing is expected relatively soon** — the
maintainer's stated intent is to add it after a few features land, not in some distant
future.

The obvious approach is `owner_id uuid references users(id)` on every table, deferring
sharing until it's needed. The question is what deferring actually costs.

It costs a lot, and the cost is concentrated in the worst place. Moving from `owner_id` to
shared ownership later means touching every domain table, every repository query, every
authorization check, and every test fixture, all at once, in a codebase that by then has
real data in it — and doing it in AI sessions that each see only part of the picture. A
migration that must be applied consistently across dozens of call sites is exactly the kind
of change that half-lands.

## Decision

**Records belong to a *space*, never directly to a user. From the first table.**

```
users              (managed by Better Auth)
spaces             id, name, kind ('personal' | 'shared'), created_at
space_members      space_id, user_id, role ('owner' | 'member'), joined_at
                   primary key (space_id, user_id)
```

- Every domain table carries `space_id not null` **and** `created_by not null`.
- `space_id` is the authorization boundary. `created_by` is provenance only — useful for
  showing who added something in a shared space, never consulted for access control.
- **Every user gets a `personal` space at signup**, with themselves as `owner`.
- A personal space is **not special-cased anywhere.** It is a space with one member. This
  is the crux: if personal spaces had their own code path, sharing would still be a
  rewrite.
- Every repository function takes `ActorContext` first and filters
  `space_id IN actor.spaceIds` ([conventions/code.md](../conventions/code.md) §2).

Family sharing then becomes: an invite flow, a `space_members` insert, and a space switcher
in the UI. **No schema migration. No repository changes. No authorization redesign.**

## Alternatives considered

- **`owner_id` on every table, migrate later.** Simpler today by roughly two tables and one
  column. Rejected on the analysis above: the later migration is broad, risky, and lands in
  a codebase with real data, edited by sessions with partial context. Given sharing is
  near-term rather than hypothetical, this trades a small certain cost now for a large
  probable cost soon.
- **Both `owner_id` and `space_id`.** Belt and braces, but two sources of truth for
  authorization — and eventually they disagree. Worse than either alone.
- **A full organizations/teams model** with nested groups, granular per-resource
  permissions, and custom roles. Over-built for a family of four. Two roles and flat
  membership cover the actual requirement; more can be added without redesign.
- **Postgres RLS as the primary enforcement.** Attractive as a hard guarantee at the
  database level. Rejected as the *primary* mechanism: it requires session variables set
  per transaction, which fights connection pooling on serverless Postgres
  ([ADR-0005](0005-postgres-neon-drizzle.md)), and it puts authorization logic in policies
  where application code can't see or test it easily. **Kept as planned defense-in-depth** —
  see below.

## Consequences

**Good:** Sharing is genuinely additive, which is the entire point. The tenant boundary is
one column and one filter — easy to state, easy to test
([conventions/testing.md](../conventions/testing.md) §2), hard to get subtly wrong. It
matches how comparable products model ownership; Papra reached the same conclusion with
"organizations" ([prior-art.md](../prior-art.md) §1).

**Bad:** Two extra tables and an extra join before any sharing feature exists. Every query
carries a space filter that is trivially satisfiable today. Signup has an extra step
(create the personal space) that must be transactional with user creation. `actor.spaceIds`
is a list rather than a single value, so every query uses `IN` rather than `=`.

**Deferred:** Postgres RLS as defense-in-depth, using
`space_id = any(current_setting('app.space_ids'))` set per transaction. Deferred because
the repository layer already enforces isolation and RLS complicates pooled connections.
**Trigger to build it: M3, before anyone else's data enters the system**
([roadmap.md](../roadmap.md)).

**Revisit if:** M3 arrives and adding sharing turns out to require query changes after all.
That would mean this ADR failed at its one job, and it should be amended with what was
missed rather than quietly worked around.
