# 0005 — No migration discipline pre-v1

## Context

The product is still being designed through active use by its one developer/user.
Schema is expected to change as domains get built out and refined. Building careful,
backward-compatible migrations for data that doesn't exist yet (or is trivially
re-enterable) is effort spent on a problem that doesn't exist yet.

## Decision

Until the product stabilizes (explicitly called out here as a "day one" allowance,
not a permanent policy): schema changes may be made freely, including resetting and
recreating the dev database, rather than writing incremental migrations for every
change.

## Consequences

- Faster iteration on the data model while domains are still being figured out.
- No migration history to rely on — don't assume old migrations are replayable or
  that current schema evolved from tracked steps.
- This decision must be revisited (superseded by a new ADR) once there's real data
  worth preserving across schema changes — e.g. once the app is used for actual
  daily tracking, or before making the app public.
