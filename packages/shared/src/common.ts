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

/**
 * A decimal amount, **as a string**. conventions/data.md §4 says money is `numeric(19,4)` and
 * never a float — and a JSON number *is* a float64, so sending one over the wire would throw
 * away the precision the column exists to keep. Postgres `numeric` accepts this string
 * directly and Drizzle returns it as one, so the value never becomes a float anywhere.
 *
 * Up to 15 integer digits and 4 decimal places, matching `numeric(19,4)` exactly.
 */
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d{1,15}(\.\d{1,4})?$/, 'Must be a decimal amount, e.g. "1250.00"')

/** ISO 4217, uppercase. Paired with every money field (conventions/data.md §4). */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Must be a 3-letter currency code')

/** ISO 3166-1 alpha-2, uppercase. */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'Must be a 2-letter country code')

/** conventions/api.md §7: `order` is `asc` or `desc` and nothing else. */
export const sortOrderSchema = z.enum(['asc', 'desc'])
export type SortOrder = z.infer<typeof sortOrderSchema>

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

/**
 * The two pagination fields, as a raw shape so a domain can spread them into its own
 * **`z.strictObject`**:
 *
 *     export const listDocumentsQuerySchema = z.strictObject({ ...pageQueryShape, q: ... })
 *
 * Spreading a shape rather than `.extend()`ing a schema is deliberate: `.extend()` on a
 * non-strict object produces a non-strict object, and **strictness is the point** —
 * conventions/api.md §7 requires unknown query parameters to be *rejected*, and a plain Zod
 * object silently strips them instead (debt D27, which is exactly this mistake made once
 * already at the Fastify level).
 */
export const pageQueryShape = {
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: cursorSchema.optional(),
} as const

export const pageQuerySchema = z.strictObject(pageQueryShape)
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
