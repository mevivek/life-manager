# Playbook: change the schema

Adding a column, changing a type, adding a table, or removing something.

Rules behind these steps: [conventions/data.md](../conventions/data.md). Migration policy:
[ADR-0011](../decisions/0011-pre-v1-schema-resets.md).

---

## 0. Check where the project is

**Pre-v1 (before M3), the development database may be reset instead of migrated.** Do not
write careful reversible backfills for disposable test data.

- [ ] Confirm the pre-v1 policy still applies — check
      [roadmap.md](../roadmap.md). If M3 has landed, **stop and read
      [ADR-0011](../decisions/0011-pre-v1-schema-resets.md)**; migrations are then
      forward-only and additive.
- [ ] Confirm the change is actually needed. Would `custom_attrs` (JSONB) do? Promote a
      JSONB key to a column only once it is universal to the domain.

## 1. Update the domain doc first

The doc is the spec; the schema implements it
([ADR-0015](../decisions/0015-docs-as-orientation.md)).

- [ ] Update §3 entity model in [`domains/<domain>.md`](../domains/)
- [ ] Add or amend any §4 business rule the change implies
- [ ] If it changes an invariant rather than adding detail, that may need an ADR

## 2. Change the Drizzle schema

In `apps/api/src/domains/<domain>/<domain>.schema.ts`.

**Every domain table carries the universal columns**
([conventions/data.md](../conventions/data.md) §1):

```ts
id          uuid        primary key default gen_random_uuid()
space_id    uuid        not null references spaces(id) on delete cascade
created_by  uuid        not null references users(id)
created_at  timestamptz not null default now()
updated_at  timestamptz not null default now()
deleted_at  timestamptz null                      -- if deletable
```

- [ ] **`space_id` is present.** A table without it cannot be queried safely — the
      repository has nothing to filter on ([ADR-0006](../decisions/0006-space-based-ownership.md))
- [ ] Correct types: `timestamptz` for instants, **`date` for calendar dates**,
      `numeric(19,4)` for money, `uuid` for ids, `text[]` for lists
- [ ] Naming: `snake_case`, `_at` for timestamps, `_on` for dates, `is_`/`has_` for booleans
- [ ] Index on `(space_id) where deleted_at is null`, plus a composite for the dominant sort
- [ ] Foreign keys are indexed — Postgres does not do this automatically
- [ ] New searchable text is in the generated `tsvector`, with sensible weighting

## 3. Generate the migration

```bash
pnpm drizzle-kit generate
```

- [ ] Generate it even pre-v1 — it costs nothing and keeps the schema's history legible
- [ ] **Read the generated SQL.** drizzle-kit occasionally infers a drop-and-recreate where
      you expected an alter
- [ ] Pre-v1: it does not need to be reversible or backfilled

## 4. Apply it

**Pre-v1**, on a Neon branch first:

```bash
pnpm drizzle-kit push      # or migrate; reset and reseed if awkward
pnpm db:seed
```

- [ ] Verify on a branch before touching the main dev database
- [ ] **Update the seed script** in the same commit. It is what makes resetting cheap; a
      stale seed quietly makes the whole pre-v1 policy unusable

## 5. Propagate the change

A schema change is never only a schema change.

- [ ] **Zod schemas** in `packages/shared` — the API contract does not update itself
      ([ADR-0004](../decisions/0004-zod-single-contract-source.md))
- [ ] **Repository** — mapping between column and API field
- [ ] **Service** — any rule touching the changed field
- [ ] **Web** — forms, list columns, detail views
- [ ] **Tests and fixtures** — prefer updating factory helpers over dozens of literals
- [ ] **Domain doc §3 and §10** if file paths moved

## 6. Finish

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass
- [ ] A fresh reset + seed + migrate works from empty — **actually run it**; this is the
      step that catches a broken seed
- [ ] OpenAPI reflects the new shape
- [ ] Migration file committed alongside the schema change

---

## Removing a column or table

Pre-v1: just remove it, regenerate, reset.

Post-M3 (real data exists), expand-and-contract over two deploys:

1. Stop writing it; deploy.
2. Stop reading it; deploy.
3. Drop it in a later migration, once you're confident nothing reads it.

Never combine a drop with a rename in one migration — if it fails halfway you cannot tell
which state you're in.

---

## Common mistakes

| Symptom | Fix |
|---|---|
| New table has no `space_id` | Add it, unless it's a join table whose parent carries one |
| `timestamp` instead of `timestamptz` | Always `timestamptz`. Store UTC with offset |
| `timestamptz` for an expiry date | Use `date` — a passport expires on a day, not an instant |
| `float` for money | `numeric(19,4)` plus a `currency` column |
| A wide set of nullable type-specific columns | Use `custom_attrs jsonb`, validated in Zod per type |
| Careful reversible migration pre-v1 | Unnecessary. Reset instead ([ADR-0011](../decisions/0011-pre-v1-schema-resets.md)) |
| Seed script left stale | Update it in the same commit, or resets stop working |
| Schema changed, Zod not updated | The contract silently drifts from the database |
| Foreign key with no index | Add one |
