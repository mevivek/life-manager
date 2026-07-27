# Code conventions

How code is organized and written. The dominant constraint is that most changes will be
made by AI sessions with no memory of previous ones, so these rules favor **explicit and
mechanically checkable** over concise.

---

## 1. Layering in `apps/api`

Four layers, strictly one-directional. A layer may call the one below it and never the one
above.

```
routes/       HTTP. Zod schemas, status codes, ActorContext resolution.
              No business logic. No SQL. Ever.
services/     Business rules. Owns transactions. Knows nothing about HTTP —
              no req, no res, no status codes.
repositories/ The ONLY layer that writes SQL. Every function takes `actor` first.
db/           Drizzle schema definitions and migrations. No logic.
```

**Why this is enforced rather than suggested:** the space filter lives in the repository
layer. A service that reaches past it into Drizzle directly bypasses tenant isolation.
That is the single most likely security bug in this codebase, and the layering is what
prevents it.

Symptoms you have crossed a boundary:

- SQL or a Drizzle query builder in a route or service → move it to a repository
- `reply.code(403)` in a service → throw a domain error; let the route map it
- A repository deciding *whether* something is allowed → that belongs in the service

## 2. The actor rule

```ts
// Every repository function. No exceptions.
export async function list(actor: ActorContext, filters: DocumentFilters) { ... }
export async function findById(actor: ActorContext, id: string) { ... }
```

`actor` is always the **first** parameter, and every query filters
`space_id IN actor.spaceIds` and `deleted_at IS NULL`.

Both conditions come from one shared helper so they cannot drift apart:

```ts
const scoped = (actor: ActorContext, table: SpaceScopedTable) =>
  and(inArray(table.spaceId, actor.spaceIds), isNull(table.deletedAt))
```

**Never construct an `ActorContext` by hand outside the auth hook or a test fixture.** If
code needs an actor it doesn't have, that is a signal it is at the wrong layer.

## 3. File and directory layout

Organized by **domain first**, layer second. A session working on Documents touches one
folder per app, not eight scattered files.

```
apps/api/src/
  domains/
    documents/
      documents.routes.ts
      documents.service.ts
      documents.repository.ts
      documents.schema.ts        Drizzle tables
      documents.test.ts
  db/           client, migrations, shared column helpers
  auth/         Better Auth setup, session → ActorContext hook
  jobs/         pg-boss registration and handlers
  lib/          errors, logger, pagination, presigning
  app.ts        plugin registration
  server.ts     entry point

apps/web/src/
  routes/       TanStack Router route files
  features/
    documents/  components, hooks, forms for one domain
  components/   shadcn/ui + shared primitives
  lib/          api client, query client, auth
```

`packages/shared/src/` mirrors the domain names: `documents.ts`, `spaces.ts`, `common.ts`.

## 4. Naming

| Thing | Convention | Example |
|---|---|---|
| Files | `kebab-case`, with a layer suffix in the API | `documents.repository.ts` |
| React components | `PascalCase`, one per file | `DocumentCard.tsx` |
| Hooks | `useThing` | `useDocuments` |
| Types / interfaces | `PascalCase`, no `I` prefix | `ActorContext` |
| Zod schemas | `thingSchema`; inferred type is `Thing` | `documentSchema` → `Document` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_UPLOAD_BYTES` |
| Booleans | `is` / `has` / `can` | `isPrimary`, `canEdit` |

Name things the way the domain doc names them. If the doc says **space**, the code says
`space` — not `tenant`, `org`, or `group`. See [glossary.md](../glossary.md).

## 5. TypeScript

- `strict: true`, plus `noUncheckedIndexedAccess`. Both are on for the whole monorepo.
- **No `any`.** Use `unknown` and narrow. If a library forces it, isolate it in one wrapper
  with a comment.
- **No non-null assertions (`!`)** outside tests. Handle the null.
- Derive types from Zod schemas (`z.infer`) rather than declaring them twice —
  [ADR-0004](../decisions/0004-zod-single-contract-source.md).
- Prefer `type` over `interface` unless you need declaration merging.
- Exhaustive `switch` over union types with a `never` default, so adding an enum member
  becomes a compile error rather than a silent fallthrough.

## 6. Errors

Domain errors are typed classes thrown by services; routes map them to
`problem+json` ([api.md](api.md) §3):

```ts
class NotFoundError   extends AppError {}  // → 404
class ForbiddenError  extends AppError {}  // → 403
class ConflictError   extends AppError {}  // → 409
class ValidationError extends AppError {}  // → 422
```

**Never swallow an error.** A bare `catch {}` or a `catch` that only logs at `debug` is a
bug. Either handle it meaningfully, log it at `warn`/`error` with context, or rethrow.

**Never leak internals to a client** — no stack traces, no SQL, no upstream messages.

Cross-space access throws `NotFoundError`, not `ForbiddenError`, so existence isn't
confirmed. See [api.md](api.md) §3.

## 7. Logging

pino, structured, one line per event.

- Always include `requestId`; include `userId` and `spaceId` when known.
- Levels: `error` for bugs and failed operations, `warn` for recoverable/suspicious,
  `info` for lifecycle and mutations, `debug` for development only.
- **Never log** passphrases, tokens, session cookies, key material, presigned URLs, or
  document contents. Add each new sensitive field to pino's redaction list.
- Log the *event*, not a sentence: `log.info({ documentId }, 'document created')`.

## 8. Async and transactions

- `async`/`await` only. No `.then()` chains, no callbacks.
- **Transactions are owned by services**, never by repositories — a repository that opens
  its own transaction cannot be composed into a larger operation.
- Anything slower than a request should be a pg-boss job, not a floating promise. Never
  fire-and-forget with an un-awaited promise; unhandled rejections vanish.

## 9. Web client

- Server state lives in **TanStack Query**. Do not copy it into `useState` — that is how
  two devices get out of sync, which is the one thing this app must not do.
- Local UI state: `useState`. Cross-component UI state: Zustand, only if genuinely needed.
- All API calls go through one typed client in `lib/api`. No bare `fetch` in a component.
- Forms: React Hook Form + the Zod resolver, using the schema from `packages/shared`.
- **The web app contains no business rules.** Validation is duplicated for UX only; the
  server is authoritative. If a rule exists only in the client, it does not exist —
  Android will not have it ([ADR-0002](../decisions/0002-api-first-decoupling.md)).

## 10. Comments

Comment **why**, not what. The code says what.

Worth a comment: a non-obvious constraint, a workaround with a link, a deliberate
deviation from these conventions, a security-relevant invariant. Not worth a comment:
restating the line below it.

Every deviation from these conventions gets a comment explaining why. A future session will
otherwise "fix" it.

## 11. Before you finish

- [ ] `pnpm typecheck` and `pnpm lint` pass (Biome — [ADR-0016](../decisions/0016-testing-and-tooling.md))
- [ ] Tests added; none weakened to get green — see [testing.md](testing.md)
- [ ] No secrets, keys, or `.env` contents in the diff
- [ ] New repository functions take `actor` and filter by space
- [ ] Docs updated if an invariant changed; new ADR if a decision was made
