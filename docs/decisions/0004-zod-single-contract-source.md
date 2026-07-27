# ADR-0004: Zod schemas are the single source of truth for the contract

- **Status:** accepted
- **Date:** 2026-07-26

## Context

The same data shape is needed in at least five places: TypeScript types in the API,
runtime validation of incoming requests, the OpenAPI document that future mobile clients
build against, TypeScript types in the web client, and client-side form validation.

Maintained separately, these drift. Drift between a type and its validator is a runtime
error; drift between the API and its published contract is a broken mobile client shipped
to an app store. Neither is caught by the compiler.

For a codebase edited by AI sessions with no shared memory, this is worse than usual — a
session that updates a type without updating the matching validator has introduced a bug
that nothing catches.

## Decision

**One Zod schema per shape, in `packages/shared`, from which everything else is derived.**

```ts
// packages/shared/src/documents.ts
export const createDocumentSchema = z.object({
  title:      z.string().min(1).max(200),
  doc_type:   documentTypeSchema,
  expires_on: z.iso.date().optional(),
})
export type CreateDocument = z.infer<typeof createDocumentSchema>
```

That one definition provides:

| Consumer | How |
|---|---|
| API runtime validation | `fastify-type-provider-zod` validates before the handler runs |
| API TypeScript types | `z.infer` — the handler's body is typed from the schema |
| OpenAPI 3.1 document | Generated from the same schemas, served at `/api/v1/openapi.json` |
| Web TypeScript types | Imported from `packages/shared` |
| Web form validation | React Hook Form's Zod resolver, same schema |

**Rules:**

- Never hand-write a TypeScript type that mirrors a schema. Use `z.infer`.
- Every endpoint declares a **response** schema too, not just a request schema — the
  response is serialized through it, so the OpenAPI contract cannot drift from the bytes.
- Schemas live in `packages/shared` and import nothing from either app.
- Database schema (Drizzle) and API schema (Zod) are deliberately separate. Not every
  column is exposed; not every field is stored. Map explicitly in the repository layer.

## Alternatives considered

- **Hand-written OpenAPI spec, generating types from it.** Contract-first, tool-agnostic,
  works across languages. Costs a YAML file to maintain by hand plus a codegen step, and
  nothing enforces that the implementation matches the spec — the drift moves rather than
  disappearing.
- **TypeBox / JSON Schema directly.** Faster validation and a more direct path to OpenAPI,
  since JSON Schema *is* the target format. Zod wins on ergonomics, on transforms and
  refinements, and on being usable unchanged in the browser for form validation. Zod's
  ecosystem reach across the whole stack matters more here than validation throughput on a
  personal app.
- **Valibot.** Smaller bundle, similar API, and a real advantage on the client. Less
  mature integration with Fastify and React Hook Form, and less training-data coverage.
- **class-validator / decorators (NestJS style).** Requires decorator metadata, doesn't
  work in the browser, and ties the contract to classes.
- **Separate schemas per side, kept in sync by review.** This is the status quo being
  rejected. It works until it doesn't, and the failure is silent.

## Consequences

**Good:** A schema change breaks the build everywhere it matters, immediately. The OpenAPI
document is always accurate because it is generated from the code that runs — which is what
makes a future mobile client a genuinely independent project
([ADR-0002](0002-api-first-decoupling.md)). Validation is guaranteed at every entry point;
there is no "we forgot to validate that one" path.

**Bad:** `packages/shared` couples the two apps — a schema change forces a rebuild of both.
That is the intent, but it does mean the web client cannot be versioned entirely
independently. Zod validation has runtime cost, negligible here. Complex conditional shapes
(discriminated unions over document types) are more awkward in Zod than in hand-written
JSON Schema.

**Revisit if:** OpenAPI generation from Zod proves inadequate for a real mobile client's
codegen. The fix is a better generator, not abandoning the single source of truth.
