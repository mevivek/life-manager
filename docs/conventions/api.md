# API conventions

Rules for the HTTP surface. Fixed now because changing them later means breaking every
client — and there will eventually be three
([architecture.md](../architecture.md) §1).

The contract is generated from Zod schemas in `packages/shared`
([ADR-0004](../decisions/0004-zod-single-contract-source.md)) and served as OpenAPI 3.1 at
`/api/v1/openapi.json` — public, in every environment, including production. A browsable Swagger
UI is mounted at `/api/v1/docs`, also public and also in every environment: it renders the same
document `/api/v1/openapi.json` already exposes, so it discloses no more than that endpoint
already does. Its "try it out" panel fires requests using whatever session cookie the browser
holds, same as any REST client.

---

## 1. Versioning

All endpoints live under `/api/v1/`. The version changes only for a **breaking** change:
removing a field, renaming one, changing a type, or tightening validation.

Adding an optional field or a new endpoint is not breaking and does not bump the version.
When `v2` arrives, `v1` keeps working until every client is known to have moved — a mobile
app on someone's phone cannot be forced to update.

## 2. Resources and verbs

Plural nouns. Standard verbs.

```
GET    /api/v1/documents           list
POST   /api/v1/documents           create
GET    /api/v1/documents/:id       read
PATCH  /api/v1/documents/:id       partial update
DELETE /api/v1/documents/:id       soft delete
```

Actions that aren't CRUD use a `:verb` suffix on the resource, which keeps them
unmistakably distinct from an `:id` segment:

```
POST /api/v1/documents/:id/files:presign-upload
POST /api/v1/documents/:id/files:confirm
```

> ### Two rules for `:verb`, both learned the hard way at M1
>
> **1. A literal colon in a Fastify route pattern must be written `::`.**
>
> Fastify treats `:` as the start of a path parameter, so registering
> `'/documents/:id/files:presign-upload'` does not do what it looks like — it registers `files`
> plus a parameter named `presign-upload`. Measured consequences: `POST /documents/x/filesGARBAGE`
> **matched**, and on a two-parameter route `request.params.fileId` came back `undefined`. Write
> `'/documents/:id/files::presign-upload'`. The URL clients call is unchanged; only the
> registration string is escaped.
>
> **2. A `:verb` may only follow a STATIC segment, never a parameter.**
>
> `@fastify/swagger` mistranslates the escape when it sits directly after a parameter:
> `'/files/:fileId::presign-download'` routes correctly but generates the OpenAPI path
> `/files/{fileId}:{presign}-download`. §3 of this file calls the OpenAPI document the contract, so
> a wrong path there is a wrong contract.
>
> When the action targets a specific sub-resource, put its id **in the body** — as
> `:presign-download` and `:confirm` both do — or use a plain path segment, as
> `POST /reminders/:id/dismiss` does. Do not write a colon after a parameter.
>
> `documents.test.ts` asserts both the 404 and the generated OpenAPI paths, because both failures
> are silent and in the too-permissive direction.

`PATCH`, not `PUT` — clients send only what changed, which matters on mobile connections
and avoids lost updates from stale full-object writes.

## 3. Errors — RFC 9457

Every error is `application/problem+json`. No bare strings, no `{ error: "..." }`, no HTML.

```json
{
  "type": "https://life-manager.app/problems/validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "expires_on must be a valid ISO date",
  "instance": "/api/v1/documents",
  "errors": [{ "path": "expires_on", "message": "Invalid date" }]
}
```

| Status | When |
|---|---|
| 400 | Malformed request — Zod rejected it |
| 401 | No valid session |
| 403 | Authenticated, but not a member of the target space |
| 404 | Not found **or** not visible to this actor (see below) |
| 409 | Conflict — version mismatch, duplicate |
| 413 | Upload exceeds the size limit |
| 422 | Well-formed but violates a business rule |
| 429 | Rate limited |
| 500 | Bug. Logged with full context; the response body says nothing useful |
| 503 | The feature exists but is **not configured on this deployment** — see below |

**404 vs 403 is deliberate.** A record in a space the actor doesn't belong to returns
**404, not 403** — a 403 would confirm the record exists, which leaks across spaces. Reserve
403 for "you are in this space but lack the role."

**503 is for an unconfigured optional feature**, added at M1. R2 (file endpoints) and VAPID (push
delivery) are deliberately optional so that `pnpm test` and a fresh clone need no external
credential — which makes "unconfigured" a real, expected runtime state. Not a 500, because nothing
is broken; not a 404, because the endpoint exists and works once configured.

**Never leak internals.** No stack traces, no SQL, no upstream error text in a response.
Log it; return a generic `detail`.

## 4. Pagination

Cursor-based, always. Offset pagination breaks when rows are inserted mid-scroll, and
infinite lists on mobile are the main consumer.

```
GET /api/v1/documents?limit=50&cursor=eyJpZCI6...
```

```json
{ "data": [ ... ], "next_cursor": "eyJpZCI6..." }
```

`next_cursor` is `null` on the last page — `null`, never absent, so "last page" is always
explicit. Default `limit` 50, max 200. Cursors are opaque to clients and validated
server-side — treat an incoming cursor as attacker-controlled.

The wire name is `next_cursor`, not `nextCursor`: §8's snake_case rule applies to every
field, including this one. The shape is defined once, in `packages/shared`'s `paginated()`.

**Implemented at M1 in `apps/api/src/lib/cursor.ts`** (debt D10, now closed), shared across domains
rather than written per endpoint — because the two parts everyone gets wrong belong in one place:

- **The `id` tie-break is not optional.** Ordering by the sort column alone means two rows sharing a
  value can straddle a page boundary, and one is skipped or repeated. Every query orders by
  `(sortColumn, id)`.
- **Nulls sort last, in both directions**, and the resume predicate has to agree with the `ORDER BY`
  or the page silently starts in the wrong place. That is why `afterCursor()` does not take a
  nulls-position option.

A malformed cursor is a **422**, not a silent page one: a cursor the client did not get from us is a
bug worth surfacing, and resetting to the first page looks like the list randomly jumping.

## 5. Idempotency

Every `POST`, `PATCH`, and `DELETE` accepts an `Idempotency-Key` header. Mobile clients
retry on flaky connections; without this, a retried upload creates two documents.

- Key + endpoint + actor → cached response, replayed for 24 hours.
- Same key with a *different* body → `409`.
- Clients should send a UUID per logical operation, not per attempt.

**Implemented at M1** (debt D9, now closed) as one plugin — `apps/api/src/lib/idempotency.plugin.ts`
— not per route. Four details that are not obvious from the rules above:

- **The header is optional.** A mutation without one behaves exactly as it did before. Requiring it
  would break `curl` and every hand-written request for a guarantee only an unreliable client needs.
- The key is claimed with a single `insert … on conflict do nothing`, so two concurrent requests are
  decided by a unique index rather than by timing. The loser gets a `409` while the first is still
  in flight.
- The body hash is of the **parsed** body, so two retries differing only in key order are the same
  operation rather than a conflict.
- **A failed operation releases its claim**, so a real retry still works. Without that, one
  transient 500 would leave a key answering 409 forever.

## 6. Authentication

Web sends the Better Auth `httpOnly` cookie; native clients send
`Authorization: Bearer <token>`. Both resolve to the same `ActorContext`, so no endpoint
branches on client type ([security-model.md](../security-model.md) §2).

Every endpoint except `/health`, `/openapi.json`, and the auth routes requires a session.
**Authentication is the default; public is the exception** — a new route is protected
unless it explicitly opts out.

## 7. Filtering and sorting

Query parameters, `snake_case`, all validated by Zod:

```
?q=passport              full-text search
?type=identity           enum filter
?expiring_before=2026-12-31
?tag=travel              repeatable
?sort=expires_on         whitelisted fields only
?order=asc|desc
```

`sort` is a whitelist, never passed through to SQL. Unknown query parameters are
**rejected**, not ignored — a typo in a filter should fail loudly rather than silently
return unfiltered data.

> **Enforced per schema, with `z.strictObject`** — debt D27, closed at M1.
>
> The rejection does **not** come for free, which is why it went unimplemented through M0: a plain
> `z.object` *strips* unknown keys and answers 200. Fastify's `ajv` options cannot do it either,
> because `fastify-type-provider-zod` replaces ajv for Zod-schema routes — an `ajv` setting added in
> this rule's name was found to be completely inert.
>
> So **every querystring schema must be `z.strictObject`**, and `pageQueryShape` in
> `packages/shared` is exported as a raw shape rather than a schema precisely so that spreading it
> cannot silently produce a non-strict object. `?expiring_befor=2026-12-31` is a 400 naming the
> unrecognised key.

## 8. Request and response shape

- JSON only. `Content-Type: application/json` required on bodies.
- Field names are `snake_case` in JSON, matching the database. One naming convention
  across the wire and the schema; TypeScript's `camelCase` conversion happens at the
  Drizzle boundary only.
- Dates: ISO 8601. Calendar dates as `YYYY-MM-DD`, instants as full ISO with `Z`. This
  mirrors the `date` vs `timestamptz` split in [data.md](data.md) §4.
- Timestamps are always UTC. Clients localize.
- `null` means "explicitly empty"; an absent key in a `PATCH` means "don't change".
- **Responses are serialized through a Zod response schema**, so the OpenAPI contract and
  the actual bytes cannot drift.
- Never return a field the actor may not see. Filter at the repository, not in the UI.

## 9. File transfer

Bytes never pass through the API
([ADR-0008](../decisions/0008-object-storage-r2.md)). No `multipart/form-data` endpoints.
Clients request a presigned URL, then talk to R2 directly.

The API always chooses the object key. A request body that contains a storage key, path,
or filename destined for storage is a design error — see
[architecture.md](../architecture.md) §6.

## 10. Rate limiting

`@fastify/rate-limit`, keyed by user when authenticated and by IP when not. Auth endpoints
(login, signup, password reset, and eventually vault unlock) get a much tighter limit than
ordinary reads. Exceeding it returns `429` with `Retry-After`.

## 11. Checklist for a new endpoint

Full recipe in
[agent-playbooks/add-an-endpoint.md](../agent-playbooks/add-an-endpoint.md). The
non-negotiables:

- [ ] Request **and** response Zod schemas in `packages/shared`
- [ ] Requires a session unless deliberately public
- [ ] Repository call passes `actor`; query filters `space_id` and `deleted_at`
- [ ] Errors are `problem+json`; cross-space access returns 404, not 403
- [ ] Mutations honor `Idempotency-Key`
- [ ] Appears correctly in the generated OpenAPI spec
- [ ] Integration test covering the happy path **and** a cross-space access attempt
