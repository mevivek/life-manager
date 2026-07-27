# Playbook: add an endpoint

Step-by-step recipe for adding one endpoint to an existing domain. Follow it in order.

**Why a recipe rather than principles:** inferring conventions from existing code is
expensive and unreliable; following an explicit sequence is cheap and consistent
([ADR-0015](../decisions/0015-docs-as-orientation.md)). The rules behind these steps are in
[conventions/api.md](../conventions/api.md) and
[conventions/code.md](../conventions/code.md) — read those if a step surprises you.

For a whole new domain, use [add-a-domain.md](add-a-domain.md) instead.

---

## 0. Before you write anything

- [ ] Read the domain doc in [`domains/`](../domains/) — §4 business rules and §5 API
      surface. If the endpoint isn't in §5, **add it there first.** The doc is the spec.
- [ ] Confirm it belongs to this domain. If it spans two, it usually belongs to the one
      that owns the data being written.
- [ ] Check it doesn't already exist under a different name.

## 1. Schemas — `packages/shared/src/<domain>.ts`

Everything derives from here
([ADR-0004](../decisions/0004-zod-single-contract-source.md)).

```ts
export const listDocumentsQuerySchema = z.object({
  q:      z.string().min(1).max(200).optional(),
  type:   z.array(documentTypeSchema).optional(),
  limit:  z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})

export const listDocumentsResponseSchema = z.object({
  data:       z.array(documentSchema),
  nextCursor: z.string().nullable(),
})

export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>
```

- [ ] Request schema (params, query, and/or body)
- [ ] **Response schema.** Not optional — responses are serialized through it, which is what
      keeps the OpenAPI contract from drifting from the actual bytes.
- [ ] Types via `z.infer`. Never hand-write a type that mirrors a schema.
- [ ] Reuse shared primitives from `packages/shared/src/common.ts` (cursor, timestamps, id)
      rather than redefining them.

## 2. Repository — `<domain>.repository.ts`

Only if new data access is needed. **The only layer that writes SQL.**

```ts
export async function list(actor: ActorContext, filters: ListDocumentsQuery) {
  return db.select().from(documents)
    .where(and(
      scoped(actor, documents),        // space_id IN actor.spaceIds AND deleted_at IS NULL
      filters.q ? matchSearch(filters.q) : undefined,
    ))
    .limit(filters.limit + 1)          // +1 to detect a next page
}
```

- [ ] `actor: ActorContext` is the **first** parameter
- [ ] Uses the shared `scoped(actor, table)` helper — never hand-write the space filter, so
      it cannot drift from the soft-delete filter
- [ ] No business logic here — that's the service
- [ ] Does not open its own transaction ([conventions/code.md](../conventions/code.md) §8)

## 3. Service — `<domain>.service.ts`

Business rules. Owns transactions. **Knows nothing about HTTP** — no `req`, no `reply`, no
status codes.

- [ ] Enforces the numbered rules from the domain doc §4
- [ ] Throws typed domain errors (`NotFoundError`, `ConflictError`, …), never HTTP codes
- [ ] Wraps multi-write operations in a transaction
- [ ] Enqueues pg-boss jobs **inside** that transaction where the job must not fire on
      rollback ([ADR-0012](../decisions/0012-pg-boss-background-jobs.md))

## 4. Route — `<domain>.routes.ts`

```ts
app.get('/documents', {
  schema: {
    querystring: listDocumentsQuerySchema,
    response: { 200: listDocumentsResponseSchema },
  },
}, async (req) => documentsService.list(req.actor, req.query))
```

- [ ] Registered under `/api/v1/`
- [ ] Requires a session — **protected is the default**; public is an explicit opt-out
- [ ] Passes `req.actor`; does not construct an `ActorContext`
- [ ] No SQL, no business logic — if the handler is more than a few lines, it's doing too
      much
- [ ] Mutations (`POST`/`PATCH`/`DELETE`) honor `Idempotency-Key`
- [ ] List endpoints use cursor pagination
      ([conventions/api.md](../conventions/api.md) §4)

## 5. Tests — `<domain>.test.ts`

Against a real Postgres ([ADR-0016](../decisions/0016-testing-and-tooling.md)).

- [ ] Happy path
- [ ] **Cross-space access returns 404.** Mandatory on every data endpoint. Two users, two
      spaces ([conventions/testing.md](../conventions/testing.md) §2)
- [ ] Unauthenticated returns 401
- [ ] Validation boundary — the value just outside what Zod accepts
- [ ] Each business rule this endpoint enforces
- [ ] Soft-deleted records are excluded

## 6. Web client — only if the UI needs it now

- [ ] Add to the typed API client in `apps/web/src/lib/api`. No bare `fetch` in a component.
- [ ] A TanStack Query hook in `features/<domain>/`
- [ ] Invalidate the affected query keys on mutation
- [ ] Forms use React Hook Form with the **same** schema from `packages/shared`

## 7. Finish

- [ ] `pnpm typecheck && pnpm lint && pnpm test` all pass
- [ ] Endpoint appears correctly in `/api/v1/openapi.json`
- [ ] Domain doc §5 lists it, and §10 still matches reality
- [ ] No secrets in the diff

---

## Common mistakes

| Symptom | Fix |
|---|---|
| Drizzle query in a route or service | Move to the repository — this is how the space filter gets bypassed |
| `reply.code(403)` inside a service | Throw a domain error; let the route map it |
| Response type hand-written | Derive with `z.infer` from the response schema |
| Returning 403 for another space's record | Return **404** — 403 confirms the record exists |
| Repository function without `actor` | Add it as the first parameter. No exceptions |
| Offset pagination | Cursor only — offsets break when rows are inserted mid-scroll |
| Test with a single user | Cannot catch a missing space filter. Seed two users in two spaces |
| Un-awaited promise for "background" work | Use a pg-boss job. Unhandled rejections vanish |
