# ADR-0011: Pre-v1, the database may be reset rather than migrated

- **Status:** accepted
- **Date:** 2026-07-26

## Context

The product is pre-v1 with a single user — the maintainer — and no data anyone would miss.
The schema will change substantially as domains are added and the first ones are refined.

Migration discipline exists to preserve data nobody can afford to lose. There is no such
data yet. Applying full discipline now means every schema experiment carries the overhead
of a forward migration, a rollback path, and a data backfill, purely to protect test
records.

There is a real cost to saying this out loud rather than leaving it implicit: an AI session
that finds no migration files and no policy will invent one, usually the most cautious one
it can. Then a session six weeks later finds hand-written backfills for a database that was
about to be dropped anyway.

## Decision

**Until milestone M3, the development database may be reset instead of migrated.**

- drizzle-kit **still generates migration files** for every schema change. They cost
  nothing, keep the schema's history legible, and mean migration discipline can begin later
  without archaeology.
- Those migrations do **not** need to be non-destructive, reversible, or backfilled.
- When a change is awkward to migrate, `drizzle-kit push` to a fresh database and reseed.
  Do not write a backfill for data that will be discarded.
- Neon branching makes this operationally trivial: branch, reset, verify, discard, with the
  main branch untouched ([ADR-0005](0005-postgres-neon-drizzle.md)).
- A seed script maintained alongside the schema makes a reset a one-command operation. Keep
  it working; it is what makes this policy usable.

**This freedom ends at M3** — family sharing
([roadmap.md](../roadmap.md)) — when another person's data enters the system. From that
point migrations are forward-only, additive, and tested against a copy of real data. The
end condition is deliberately a *milestone*, not a date or a vibe.

## Alternatives considered

- **Full migration discipline from the first table.** The professional default. Rejected as
  pure overhead at this stage: careful reversible migrations to protect a handful of test
  documents, slowing down exactly the phase where the schema *should* change freely.
- **No migration files at all until M3** — just `drizzle-kit push`. Simpler still, and
  tempting. Rejected because the schema's evolution becomes invisible: a session cannot see
  why a column exists, and the day discipline starts there is no baseline to migrate from.
  Generating the files is nearly free; discarding them is not.
- **Leaving the policy implicit.** Rejected on the reasoning above — an unstated policy gets
  re-invented by every session, inconsistently.

## Consequences

**Good:** Schema changes are cheap during the phase when they should be. No time spent
writing backfills for disposable data. Sessions get an explicit, unambiguous answer to
"should I write a careful migration here?"

**Bad:** Test data is lost on every reset — mitigated by the seed script, which must
therefore be kept current. Nothing exercises the migration path, so the first real migration
at M3 will be the first one ever run in anger; do it against a Neon branch of production
first. And there is a genuine risk of the policy outliving its context — if M3 arrives and
nobody notices, this ADR quietly becomes dangerous.

**Guard against that:** [roadmap.md](../roadmap.md) M3 lists ending this policy as an
explicit deliverable, and this ADR should be superseded — not just amended — when it does.

**Revisit if:** M3 is reached, *or* any data enters the system that would be genuinely
painful to lose. The trigger is real data, not the calendar. If you find yourself
hesitating to reset the database, the policy has already expired.
