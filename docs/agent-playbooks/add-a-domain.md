# Playbook: add a domain

Adding a whole new life domain — Assets, Money, People, Notes, Vault. This is the largest
recurring structural task in the project, and the one most worth making mechanical.

Prerequisite: **the domain doc is written and its open questions are settled.** Do not start
from a one-line description. See [ADR-0015](../decisions/0015-docs-as-orientation.md) for
why the doc leads.

---

## 0. Product gate — before any file is written

- [ ] The domain is **on [roadmap.md](../roadmap.md)** in a milestone. If it isn't, it has
      not passed the human gate ([ADR-0017](../decisions/0017-product-brain.md)) — stop and
      raise it in [product/idea-backlog.md](../product/idea-backlog.md) instead.
- [ ] The previous domain is genuinely finished and in use. **One domain at a time** is the
      anti-goal most likely to be violated and the one most likely to sink the project
      ([product/brain.md](../product/brain.md) §5).

## 1. Write the domain doc

Copy [`domains/_template.md`](../domains/_template.md) to `domains/<domain>.md` and fill in
**every** section, in order. Do not reorder or drop sections — the fixed shape is what lets
a future session jump to §4 without reading §1–3.

- [ ] Header: status, milestone, **sensitivity tier**, dependencies
- [ ] §2 Scope — especially *out of scope*, naming which domain owns what instead. This is
      what stops domains growing into each other
- [ ] §3 Entity model, per [conventions/data.md](../conventions/data.md)
- [ ] §4 Business rules, numbered and testable — each should map to a test
- [ ] §5 API surface
- [ ] §8 Cross-domain links — record intent even for domains that don't exist yet; this is
      where the product's value concentrates
      ([product/brain.md](../product/brain.md) principle 4)
- [ ] §9 Open questions — technical ones here, product ones in
      [product/open-questions.md](../product/open-questions.md)

**Sensitivity tier is a real decision**, not a formality. Default to **Tier 0** unless the
domain is the vault. Anything else needs an ADR
([ADR-0009](../decisions/0009-sensitivity-tiers.md)).

- [ ] Add the domain to the [`docs/README.md`](../README.md) routing table

## 2. Shared schemas

`packages/shared/src/<domain>.ts` — one Zod schema per shape, types via `z.infer`
([ADR-0004](../decisions/0004-zod-single-contract-source.md)).

- [ ] Entity, create, update, and query schemas
- [ ] **Response schemas** for every endpoint
- [ ] Reuse `common.ts` primitives; don't redefine cursors or timestamps
- [ ] No imports from either app
- [ ] Query schemas are **`z.strictObject`**, spreading `pageQueryShape` rather than `.extend()`ing a
      schema — `.extend()` on a non-strict object produces a non-strict object, and strictness is the
      whole of conventions/api.md §7 (debt D27)
- [ ] **Check every schema you REUSE from another domain for an assumption that it is the only
      domain.** Added at M4 step 1: `reminderSchema.entity_type` was `z.literal('document')`, and
      `reminders` is a deliberately generic table — so a thing's reminders failed the *thing's own*
      response schema, which is a 500 on a screen that draws them. Widening a response enum is not a
      breaking change (conventions/api.md §1); leaving it narrow is a runtime error

> **Adding a field to a shared response schema is a deploy-ordering hazard.** The web and API deploy on
> separate triggers, so a field the client *requires* of the server takes the app down while the API
> lags — debt **D54**, which happened. `.nullish().default(null)`, never `.nullable()`, for anything the
> server might not send yet.

## 3. Database schema

`apps/api/src/domains/<domain>/<domain>.schema.ts`. Follow
[change-the-schema.md](change-the-schema.md) §2–4.

- [ ] Universal columns on every table, **including `space_id`** — use `spaceScoped()`,
      `timestamps()`, `softDelete()` rather than writing them out
- [ ] **`versioned()` on every table whose rows a user can EDIT** — the ADR-0024 optimistic-concurrency
      counter. Its `PATCH` then takes the version as a **required** field, so a forgotten precondition
      is a type error rather than silent last-write-wins, and its `DELETE` takes `?version=` (debt
      D41). An append-or-remove child table (a service log, a file list) does not need one, and should
      carry a comment saying so — otherwise the next session adds it "for consistency"
- [ ] **Re-export the tables from `db/schema/index.ts`.** That barrel is the only thing
      `drizzle.config.ts` and `db/client.ts` read, so a table missing from it does not exist as far
      as migrations or the query builder are concerned — and the failure is a silently absent table,
      not an error
- [ ] Indexes: `(space_id) where deleted_at is null`, plus the dominant sort
- [ ] Generated `tsvector` if the domain is searchable
- [ ] **Add the new tables to `truncateAll()` in `src/test/db.ts`.** Forgetting this shows up as one
      suite polluting the next, which looks like flakiness rather than a missing line
- [ ] Migration generated; seed script extended

> ### If another domain already has a column pointing at your new table
>
> Added at M4 step 1, because `documents.thing_id` had shipped as a bare `uuid` with no constraint
> months before `things` existed. Three things follow, and none is obvious:
>
> 1. **The importing direction decides whether you get a cycle.** `documents.schema.ts` imports
>    `things.schema.ts` for its `.references()`, and nothing on `things` points back — the whole
>    relationship is that one column. Keep it that way: a mutual reference between two domain schema
>    files is an import cycle Drizzle will not save you from.
> 2. **Choose `on delete` from the domain doc, not from habit.** `set null` was a business rule
>    (things.md §4 rule 5 — deleting a car must not shred its paperwork, and the delete control's copy
>    says so). `cascade` is the default people reach for and would have made that copy a lie.
> 3. **A pre-existing column may already hold values your new constraint rejects.** Adding the foreign
>    key to a table that has been accepting arbitrary uuids fails on the first dangling row — and
>    ADR-0023 applies migrations **on boot**, so that is a production outage rather than a failed
>    build. Add a `UPDATE … SET fk = NULL WHERE NOT EXISTS (…)` statement to the generated migration
>    *before* the `ADD CONSTRAINT`, with a comment saying it is hand-added and why. It is expected to
>    change zero rows; "expected to change zero rows" and "cannot take the API down" are different
>    claims.
>
> **Also update `migrations.test.ts`**: every constraint a domain doc states as a rule should be
> asserted at the database level there, the way the one-primary-file and one-personal-space indexes are.
> A soft delete does not fire `on delete set null`, so an API-level test cannot reach that constraint at
> all — it needs a hard `delete from` in that file.

> **Generated columns must be IMMUTABLE, which is narrower than it looks.** M1 lost time to this:
> `array_to_string(tags, ' ')` is **STABLE**, and Postgres rejects the entire table with
> `generation expression is not immutable`. Use `array_to_tsvector` for a text array, and always the
> two-argument `to_tsvector('english', …)` — the one-argument form reads
> `default_text_search_config` and is only STABLE too. Check `provolatile` in `pg_proc` if unsure
> rather than guessing.

## 4. Repository

`<domain>.repository.ts` — **the only layer that writes SQL.**

- [ ] Every function takes `actor: ActorContext` first
- [ ] Every query uses the shared `scoped(actor, table)` helper
- [ ] No business logic, no transactions of its own
- [ ] A function that genuinely cannot take an actor (a cron job, a maintenance sweep) is named
      `…ForMaintenance` and carries a comment saying why — see `reminders.repository.ts`

> **Do not hand-write a correlated subquery in a select-field position.** Drizzle renders columns
> *unqualified* there, so `where ${child.parentId} = ${parent.id}` becomes
> `where "parent_id" = "id"` and silently resolves `"id"` to the child's own column. Use
> `db.$count(table, where)`, which qualifies by construction. This cost M1 a bug that 136 tests
> missed — debt D33.

> ### A correlated count over ANOTHER domain's table needs its own space predicate
>
> Added at M4 step 1, where it was a real (caught) cross-space leak. `things.document_count` counts
> rows in `documents`, and the outer query being `scoped()` does **not** scope the subquery. The
> tempting argument — *"they are in the same space by construction"* — is false wherever the linking
> column is client-settable: a foreign key checks that the parent **exists** and cannot check whose
> space it is in, so a caller in space B can file a row against space A's id and inflate space A's
> count. Write `eq(child.spaceId, parent.spaceId)` into the `db.$count` predicate.
>
> The tell that this survives a suite: the *nested list* beside the count goes through `scoped()` and is
> correct, so the row says "3 documents" above a section listing two. Assert both, in one test, with a
> second space involved.

## 5. Service

`<domain>.service.ts` — business rules, owns transactions, no HTTP.

- [ ] Every numbered rule from domain doc §4 is implemented
- [ ] Typed domain errors, not status codes
- [ ] pg-boss jobs enqueued inside the transaction where rollback must cancel them
- [ ] **Columns that must move together get ONE helper that writes all of them**, called from create and
      update alike. `documents.service.ts` has `identifierColumns` and `holderColumns`; Things added
      `serialColumns` and `ownershipColumns`. The failure a helper prevents is silent and only visible
      in a list: a patch clearing `holder` leaves "Wife" behind, or an edit updates a value and leaves
      yesterday's derived mask on the row. A `.refine()` is **not** the tool for this — a refine can
      only reject the bad combination, and the useful behaviour is usually to fix it
- [ ] **A rule that is a question the product has not answered gets the CAPABILITY and not the switch.**
      Build the plumbing, leave nothing that creates the row, and put a test on the *absence* naming the
      open question and which test to change. Things' §9(2) (automatic warranty reminders) is the worked
      example — the domain doc said in as many words "do not decide it in a repository"

> **A partial unique index is checked per statement, not at commit — so order the statements.** Added at
> M4 step 1: `confirmPhotoUpload` confirmed the incoming photo and *then* demoted the old hero, which
> meant one statement's worth of two confirmed heroes and a flat rejection from Postgres. Symptom was a
> 500 on the second photo of any thing. Demote first, promote second. The same shape as
> `documents.files.service.ts`'s demote-then-promote, which had it right — **read the sibling service
> before writing yours.**

## 6. Routes

`<domain>.routes.ts`, registered in `app.ts`. Per endpoint, follow
[add-an-endpoint.md](add-an-endpoint.md) §4.

- [ ] Everything under `/api/v1/`
- [ ] Protected by default
- [ ] Matches domain doc §5 exactly — if you deviate, update the doc in the same commit

## 7. Background jobs

If domain doc §6 lists any: `apps/api/src/jobs/<domain>-*.ts`, registered with pg-boss
([ADR-0012](../decisions/0012-pg-boss-background-jobs.md)).

- [ ] Retry and failure behavior matches what the doc says
- [ ] A job whose silent failure would be invisible to the user **alerts** — a reminder scan
      that quietly dies means silently missed renewals

## 8. Tests

Colocated, against a real Postgres.

- [ ] **A cross-space 404 test for every data endpoint.** Non-negotiable
      ([conventions/testing.md](../conventions/testing.md) §2). `seedTwoUsers(app)` exists so this is
      a one-liner and nobody skips it for being tedious
- [ ] One test per business rule in §4, each naming the rule number
- [ ] Factory helpers (`seedUserWithSpace`, `create<Entity>`) added to the shared fixtures
- [ ] Job handlers tested directly, including the failure path
- [ ] **Assert a non-zero count, and assert it changes.** M1's `file_count` was broken for the whole
      milestone because every assertion happened to expect `0` — a new record, an unconfirmed
      upload — so a constant-zero query satisfied all of them (debt D33)
- [ ] **Run the flow in a browser before calling the domain built.** Two of M1's real bugs were
      invisible to the suite and obvious on screen

## 9. Web client

`apps/web/src/features/<domain>/` plus routes in `apps/web/src/routes/`.

- [ ] Typed API client methods in `lib/api`
- [ ] TanStack Query hooks; server state stays in Query, never copied into `useState`
- [ ] Forms via React Hook Form with the shared schemas
- [ ] Screens listed in domain doc §7
- [ ] **No business rules in the client** — validation there is UX only
      ([ADR-0002](../decisions/0002-api-first-decoupling.md))

## 10. Close out

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass — **and check the skip count**, since the
      database suites skip silently without Docker or `TEST_DATABASE_URL`
- [ ] Endpoints correct in `/api/v1/openapi.json`
- [ ] Domain doc §10 **Files** lists real paths, `(planned)` markers removed
- [ ] Domain doc status → `built`
- [ ] [roadmap.md](../roadmap.md) updated
- [ ] [product/idea-backlog.md](../product/idea-backlog.md) — related ideas moved to `built`
- [ ] Any decision made along the way has an ADR
- [ ] **Used it in real life for a week** before calling it done
      ([roadmap.md](../roadmap.md) standing rules)

---

## If this playbook didn't work

Adding a domain should be mechanical. If you had to improvise, infer a convention from
another domain's code, or got stuck on something this playbook doesn't cover — **fix the
playbook in the same commit.**

That is not optional politeness. The playbook is the mechanism by which the next session
does this consistently; leaving it stale means the next session improvises differently, and
the domains diverge. [roadmap.md](../roadmap.md) M4 treats this as a real test.

### The M4 step 1 measurement — Things, 2026-07-30

The first domain added by following this file rather than by writing it. **The structure worked**: one
folder, the four layers in order, and — the thing ADR-0006 said would be measured — **`db/scoped.ts` was
not touched.** `spaceScoped()` gave the three new tables the columns `SpaceScopedTable` structurally
requires, so `scoped(actor, things)` type-checked on first use.

Five things had to be improvised, and each is now a checklist item or a note above:

1. `versioned()` was not mentioned at all (§3), though ADR-0024 requires it on any editable table.
2. Nothing covered **a foreign key from a domain that already exists into the new one** — the import
   direction, choosing `on delete` from the domain doc, and the migration guard against pre-existing
   dangling values (§3).
3. Nothing warned that a **correlated count over another domain's table needs its own space
   predicate** (§4). This was a real cross-space leak, caught only because the count test drove a
   non-zero value with a second space present.
4. Nothing said that a **partial unique index is checked per statement**, so demote-then-promote
   ordering matters (§5). This was a 500.
5. Nothing said to check **reused shared schemas for single-domain assumptions** (§2) — a `z.literal`
   on a generic table's discriminator.

Two smaller ones, folded into §3: adding the new tables' constraints to `migrations.test.ts`, and the
`z.strictObject` requirement on query schemas (which conventions/api.md §7 has but this file did not).
