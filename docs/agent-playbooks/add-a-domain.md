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
      ([product/brain.md](../product/brain.md) §4).

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
      where the product's value concentrates ([product/brain.md](../product/brain.md) §3)
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

## 3. Database schema

`apps/api/src/domains/<domain>/<domain>.schema.ts`. Follow
[change-the-schema.md](change-the-schema.md) §2–4.

- [ ] Universal columns on every table, **including `space_id`**
- [ ] Indexes: `(space_id) where deleted_at is null`, plus the dominant sort
- [ ] Generated `tsvector` if the domain is searchable
- [ ] Migration generated; seed script extended

## 4. Repository

`<domain>.repository.ts` — **the only layer that writes SQL.**

- [ ] Every function takes `actor: ActorContext` first
- [ ] Every query uses the shared `scoped(actor, table)` helper
- [ ] No business logic, no transactions of its own

## 5. Service

`<domain>.service.ts` — business rules, owns transactions, no HTTP.

- [ ] Every numbered rule from domain doc §4 is implemented
- [ ] Typed domain errors, not status codes
- [ ] pg-boss jobs enqueued inside the transaction where rollback must cancel them

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
      ([conventions/testing.md](../conventions/testing.md) §2)
- [ ] One test per business rule in §4
- [ ] Factory helpers (`seedUserWithSpace`, `create<Entity>`) added to the shared fixtures
- [ ] Job handlers tested directly, including the failure path

## 9. Web client

`apps/web/src/features/<domain>/` plus routes in `apps/web/src/routes/`.

- [ ] Typed API client methods in `lib/api`
- [ ] TanStack Query hooks; server state stays in Query, never copied into `useState`
- [ ] Forms via React Hook Form with the shared schemas
- [ ] Screens listed in domain doc §7
- [ ] **No business rules in the client** — validation there is UX only
      ([ADR-0002](../decisions/0002-api-first-decoupling.md))

## 10. Close out

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass
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
