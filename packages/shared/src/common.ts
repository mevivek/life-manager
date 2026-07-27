import { z } from 'zod'

/**
 * Primitives shared by every domain contract.
 *
 * ADR-0004: these Zod schemas are the ONLY source of the wire contract. Never hand-write a
 * TypeScript type that mirrors one — infer it.
 *
 * Wire field names are snake_case (conventions/api.md §8). camelCase exists only inside
 * TypeScript, and the conversion happens at the Drizzle boundary.
 */

export const uuidSchema = z.uuid()

/** A calendar date, `YYYY-MM-DD`. Column type `date`. See conventions/data.md §4. */
export const isoDateSchema = z.iso.date()

/** An instant, full ISO 8601 with a UTC offset. Column type `timestamptz`. */
export const isoDateTimeSchema = z.iso.datetime()

/** conventions/api.md §4: roles are `owner` and `member`. Nothing else exists. */
export const spaceRoleSchema = z.enum(['owner', 'member'])
export type SpaceRole = z.infer<typeof spaceRoleSchema>

// ── Pagination ───────────────────────────────────────────────────────────────
//
// Defined here at M0 but used by NOTHING yet: no list endpoint exists. It lives here so
// the first M1 list endpoint inherits a cursor contract instead of inventing one.
// Registered as debt (docs/product/review.md D10) with a trigger.

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

/**
 * An opaque, server-validated cursor. conventions/security-model.md §1(2): treat an
 * incoming cursor as attacker-controlled — it is base64 of a server-chosen payload, and
 * decoding it must never be trusted to produce a well-formed one.
 */
export const cursorSchema = z.string().min(1).max(512)

export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: cursorSchema.optional(),
})
export type PageQuery = z.infer<typeof pageQuerySchema>

/** `next_cursor` is `null` on the last page. */
export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: cursorSchema.nullable(),
  })

// ── Errors ───────────────────────────────────────────────────────────────────

/** Stable base URI for the `type` member. Never a live URL that must resolve. */
export const PROBLEM_BASE_URI = 'https://life-manager.app/problems'

/**
 * RFC 9457 `application/problem+json`. Every error response in the API is this shape —
 * conventions/api.md §3. It is referenced as the 4xx/5xx response schema on routes so that
 * error shapes land in the generated OpenAPI document, not just success shapes.
 */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string(),
  instance: z.string().optional(),
  errors: z
    .array(
      z.object({
        path: z.string(),
        message: z.string(),
      }),
    )
    .optional(),
})
export type Problem = z.infer<typeof problemSchema>
