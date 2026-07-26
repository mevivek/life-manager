# 0003 — Multi-user from day one

## Context

Only one person uses the app during development, but the intent is to potentially
make it public later. Retrofitting multi-user isolation onto a single-user schema
later is exactly the kind of painful rework this documentation scaffold is meant to
help avoid.

## Decision

- Every domain table carries a `user_id` from the first migration, even though
  there's currently one real user.
- Authorization is enforced in the backend (`apps/api`) on every query — the backend
  is the trust boundary, not just the database.
- Postgres Row Level Security is also enabled per table as defense-in-depth, scoped
  to `user_id`, but is not relied upon as the *only* authorization mechanism.
- No cross-user sharing/permissions model is built now — each user's data is fully
  private to them. Family/shared-visibility use cases were explicitly deprioritized
  in favor of "many independent private users," matching how the product would work
  if made public.

## Consequences

- Slightly more schema/query overhead now (every query filtered by `user_id`) for
  a feature only one user currently exercises.
- Avoids a hard migration later: opening the app to other users means adding
  signup flow polish, not restructuring data ownership.
- Sharing between users (e.g. family members) is out of scope until explicitly
  requested — if it's ever needed, it's a new decision, not an extension of this one.
