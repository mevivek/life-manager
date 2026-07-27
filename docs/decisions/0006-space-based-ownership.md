# ADR-0006: Space-based ownership from day one

- **Status:** accepted
- **Date:** 2026-07-26
- **Amended:** 2026-07-27 — the personal-space guarantee is restated in terms of what is actually
  enforced. This ADR originally said signup's extra step "must be transactional with user
  creation"; Better Auth cannot do that, so M0 delivers the same guarantee with a database
  constraint plus an idempotent, retried creation path. Amended rather than superseded because the
  **decision is unchanged** — records belong to spaces, every user has exactly one personal space
  they own, and a personal space is not special-cased. Only the stated *mechanism* was wrong, and
  it was wrong from the day it was written rather than changed by anything since.

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
- **Every user ends up with exactly one `personal` space, owned by them.**
- A personal space is **not special-cased anywhere.** It is a space with one member. This
  is the crux: if personal spaces had their own code path, sharing would still be a
  rewrite.
- Every repository function takes `ActorContext` first and filters
  `space_id IN actor.spaceIds` ([conventions/code.md](../conventions/code.md) §2).

### How the personal-space guarantee is enforced

Stated precisely, because the obvious reading — "one transaction with user creation" — is not
achievable and a doc claiming it would be fiction ([review.md](../product/review.md) lens 3).

**Better Auth cannot create the space in the same transaction as the user.**
`databaseHooks.user.create.after` is queued to run *after* that transaction commits, by design
(better-auth issue #7260); an after-hook that inserts a row referencing the new user inside the
transaction hits a foreign-key violation because it cannot see the uncommitted row. A `before`
hook cannot work either — `space_members.user_id` needs the user to exist. Getting a genuine
single transaction would mean forking Better Auth's signup or hand-writing the auth-table
inserts, both far worse trades than the alternative below.

So the guarantee comes from three mechanisms instead of one:

1. **Atomic where it matters.** `spacesService.ensurePersonalSpace()` creates the `spaces` row and
   its `owner` `space_members` row in one transaction. No user can ever have an orphan space, and
   no space can ever exist without an owner.
2. **At most one, enforced by the database.** `spaces.personal_for_user_id` carries a partial
   unique index (`where personal_for_user_id is not null`), so a second personal space for the
   same user is impossible. `ensurePersonalSpace` inserts with `on conflict do nothing` and
   re-reads, which makes it idempotent under concurrency rather than merely idempotent in code.
   See [conventions/data.md](../conventions/data.md) §9. **Nothing reads that column except
   `ensurePersonalSpace`** — it is a uniqueness guard, not a code path, so "not special-cased
   anywhere" still holds.
3. **At least one, enforced by retry.** Two independent callers invoke it: the signup after-hook,
   and the session → `ActorContext` hook whenever it sees a session with no memberships. If the
   first ever dies between commit and hook, the user's next request repairs it and logs a `warn`.

Net: **exactly one personal space per user.** The mechanism is a constraint plus idempotent
retry, not atomicity with user creation.

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
carries a space filter that is trivially satisfiable today. Signup has an extra step (create the
personal space) which cannot be transactional with user creation, and therefore costs a column, a
partial unique index, and a self-healing branch in the auth hook to guarantee properly — see
above. `actor.spaceIds` is a list rather than a single value, so every query uses `IN` rather
than `=`.

**Open, for M3:** `ActorContext.role` is a single scalar while `spaceIds` is a list
([security-model.md](../security-model.md) §3 calls it "role in the space being acted upon"). Those
cannot both be right once a user belongs to two spaces. At M0 there is exactly one space per user,
so it is that space's role. The likely fix is `memberships: ReadonlyArray<{ spaceId, role }>` with
the role resolved per target space — an edit to security-model.md §3, and therefore a human
decision rather than a refactor. Recorded in
[open-questions.md](../product/open-questions.md).

**Deferred:** Postgres RLS as defense-in-depth, using
`space_id = any(current_setting('app.space_ids'))` set per transaction. Deferred because
the repository layer already enforces isolation and RLS complicates pooled connections.
**Trigger to build it: M3, before anyone else's data enters the system**
([roadmap.md](../roadmap.md)).

**Revisit if:** M3 arrives and adding sharing turns out to require query changes after all.
That would mean this ADR failed at its one job, and it should be amended with what was
missed rather than quietly worked around.
