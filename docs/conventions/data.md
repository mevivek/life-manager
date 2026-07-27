# Data conventions

Schema rules for every table in life-manager. These exist so a future session can add a
table without re-deriving the ownership, timestamp, and deletion patterns — and, more
importantly, so it cannot accidentally create a table that leaks across spaces.

Defined with Drizzle in `apps/api/src/db/schema/`, one file per domain.

---

## 1. Universal columns

**Every domain table has these five. No exceptions.**

```ts
id          uuid        primary key, default gen_random_uuid()
space_id    uuid        not null, references spaces(id) on delete cascade
created_by  uuid        not null, references users(id)
created_at  timestamptz not null, default now()
updated_at  timestamptz not null, default now()
```

Plus, on anything a user can delete:

```ts
deleted_at  timestamptz null    -- soft delete; NULL means live
```

**`space_id` is the tenant boundary.** A table without it cannot be queried safely, because
the repository layer has nothing to filter on. If you are adding a table and think it
doesn't need a `space_id`, it is either (a) a join table whose parent carries one, or
(b) a mistake. See [ADR-0006](../decisions/0006-space-based-ownership.md).

**`created_by` is not ownership.** It is provenance — useful in a shared space to show who
added something. Authorization never consults it; authorization consults space membership.

## 2. Indexes

Every domain table gets, at minimum:

```sql
create index on <table> (space_id) where deleted_at is null;
```

Every query the repository issues filters on `space_id`, so this is the index that matters.
Add a composite index when a domain has a dominant sort — Documents sorts by expiry, so it
gets `(space_id, expires_on) where deleted_at is null`.

Foreign keys get indexes; Postgres does not create them automatically.

## 3. Soft deletes

Deletes set `deleted_at = now()`. They do not remove rows.

- **Every repository read must include `deleted_at is null`.** This is as non-negotiable as
  the space filter. Both live in the same shared query helper so they cannot drift apart.
- Partial indexes use `where deleted_at is null` so they stay small.
- Hard deletion happens only via an explicit purge path (account deletion), never as a
  side effect of a normal delete.
- Deleting a document soft-deletes its files but **does not delete the R2 objects** — object
  cleanup is a separate job, so that an accidental delete is recoverable.

## 4. Types

| Use | Type | Not |
|---|---|---|
| Identifiers | `uuid` (v4, DB-generated) | serial/bigint — leaks row counts and ordering |
| Timestamps | `timestamptz` | `timestamp` — always store UTC with offset |
| Calendar dates | `date` | `timestamptz` — an expiry date has no time or timezone |
| Money | `numeric(19,4)` + a separate `currency char(3)` | float — never |
| Enumerations | Postgres `enum` when stable, `text` + Zod when still moving | |
| Free-form attributes | `jsonb` | a wide table of nullable columns |
| Tags / string lists | `text[]` | comma-joined strings |

**`expires_on` is a `date`, not a timestamp.** A passport expires on a day, not at an
instant. Getting this wrong makes reminders fire in the wrong timezone.

## 5. JSONB — the `custom_attrs` pattern

Domains with type-varying fields (a passport has a nationality; a warranty has a retailer)
use a single `custom_attrs jsonb not null default '{}'` column rather than dozens of
nullable columns.

Rules:

- **The shape is validated in Zod at the API edge**, per document type. JSONB is flexible
  in the database, not in the contract — the client cannot write arbitrary keys.
- Never query `custom_attrs` in a hot path without a supporting expression index.
- If a key inside `custom_attrs` becomes universal, promote it to a real column. Pre-v1
  that is free ([ADR-0011](../decisions/0011-pre-v1-schema-resets.md)).

## 6. Full-text search

Generated `tsvector` column plus a GIN index, per searchable table:

```sql
search_vector tsvector generated always as (
  setweight(to_tsvector('english', coalesce(title,  '')), 'A') ||
  setweight(to_tsvector('english', coalesce(issuer, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(notes,  '')), 'C')
) stored;

create index on <table> using gin (search_vector);
```

Generated, not trigger-maintained — Postgres keeps it correct with no application code to
forget. Weighting matters: a title match should outrank a note match.

Search is still scoped by `space_id`. Full-text search is not an authorization bypass.

## 7. Naming

- Tables: plural `snake_case` — `documents`, `document_files`, `space_members`
- Columns: `snake_case`. Drizzle maps them to `camelCase` in TypeScript; let it.
- Foreign keys: `<singular>_id` — `space_id`, `document_id`
- Booleans: `is_` / `has_` — `is_primary`
- Timestamps: `_at`. Dates: `_on`. This is how you tell `created_at` from `expires_on` at a
  glance, and it encodes the `timestamptz` vs `date` rule from §4.
- Enum values: `snake_case`, singular — `identity`, `warranty`

## 8. Migrations

Pre-v1, drizzle-kit generates migrations but **the dev database may be reset rather than
migrated** ([ADR-0011](../decisions/0011-pre-v1-schema-resets.md)). Generate them anyway —
they cost nothing and mean migration discipline can start without archaeology.

Neon branching makes this cheap: branch, reset, verify, discard.

This freedom ends at **M3** ([roadmap.md](../roadmap.md)), when another person's data enters
the system. From then on, migrations are forward-only and additive.

## 9. Reference: the foundation tables

```
users              managed by Better Auth. Do not hand-edit its columns; extend via a
                   separate profile table if needed.
spaces             id, name, kind ('personal' | 'shared'), created_at
space_members      space_id, user_id, role ('owner' | 'member'), joined_at
                   primary key (space_id, user_id)
```

Every user gets a `personal` space at signup with themselves as `owner`. A personal space
is not special-cased anywhere — it is simply a space with one member, which is what makes
family sharing additive.
