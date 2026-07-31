import { isoDateSchema, isoDateTimeSchema, uuidSchema } from '@life-manager/shared'
import { and, gt, isNull, or, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import { BadRequestError } from './errors.js'

/**
 * Keyset (cursor) pagination. conventions/api.md §4: cursor-based, **always** — offset
 * pagination breaks when rows are inserted mid-scroll, and infinite lists on mobile are the
 * main consumer.
 *
 * Closes debt D10: `packages/shared` has carried the cursor *shape* since M0 with no endpoint
 * to prove it. This is the implementation, written once here rather than per domain, because
 * the null-handling below is the part everyone gets wrong.
 *
 * **Treat an incoming cursor as attacker-controlled** (conventions/api.md §4). It is opaque
 * base64, not a signed token — so nothing here trusts it for authorization. A forged cursor
 * cannot cross a space boundary, because the tenant filter is a separate `AND` that a cursor
 * cannot reach.
 *
 * **But "cannot leak" is not "harmless", and this file used to claim it was.** Until 2026-07-30 the
 * sentence above ended "the worst a forged cursor can do is start the page somewhere odd within the
 * caller's own space" — which was measurably false. A *well-formed* cursor carrying a non-uuid `i`,
 * or a sort value of the wrong type for the column it is compared against, was bound straight into
 * the `WHERE` clause, and Postgres raised `22P02 invalid input syntax for type uuid`, which reached
 * the client as a **500** on every paginated endpoint. So: still not a read across spaces, but a
 * guaranteed outage for anyone who can send a query string. Validate the whole payload, and reject
 * a bad one *before* it reaches the database — which is what `decodeCursor` now does.
 */

/** The decoded cursor. `sortValue` is `null` when the last row's sort column was null. */
export type Cursor = {
  sortValue: string | null
  id: string
}

/**
 * What a sort column's cursor value has to *look* like. Three kinds because that is what the two
 * sort whitelists actually contain — `text`, `date` (`YYYY-MM-DD`) and `timestamp` (full ISO).
 *
 * It exists so validation follows the **column**, not a guess: `nope` is a perfectly good cursor for
 * `title` and a `22P02` for `expires_on`, so there is no single rule that is right for both. Derived
 * by `sortValueKind()` below rather than declared beside each sort whitelist, so a hand-maintained
 * parallel map cannot drift out of step with the column it describes.
 */
export type CursorSortKind = 'text' | 'date' | 'timestamp'

/**
 * The kind of value a column holds, read off the Drizzle column itself.
 *
 * Throws a plain `Error` — not a client-facing one — for a column type no cursor has sorted by yet:
 * that is a programming error at wiring time, not something a request can cause, and failing loudly
 * is how the next sort column added (a `numeric`, say) gets a deliberate decision rather than
 * silently inheriting `text` comparison semantics.
 */
export function sortValueKind(column: AnyPgColumn): CursorSortKind {
  switch (column.columnType) {
    case 'PgText':
    case 'PgVarchar':
    case 'PgChar':
      return 'text'
    case 'PgDate':
    case 'PgDateString':
      return 'date'
    case 'PgTimestamp':
    case 'PgTimestampString':
      return 'timestamp'
    default:
      throw new Error(`sortValueKind(): no cursor rule for column type ${column.columnType}`)
  }
}

/**
 * The cursor's own payload schema.
 *
 * **Deliberately here and not in `packages/shared`, which invariant 9 would otherwise require.** The
 * contract source rule governs the *wire*, and this shape is never on the wire: a cursor is an
 * opaque token that only this file mints and only this file reads (`cursorSchema` in shared — the
 * opaque bounded string a client actually sends — stays there). Putting it in shared would publish
 * an internal encoding to every client as though it were guaranteed.
 *
 * `strictObject`, because an unrecognised key means the cursor did not come from `encodeCursor`.
 */
const cursorPayloadSchema = z.strictObject({
  v: z.literal(1),
  s: z.string().nullable(),
  i: uuidSchema,
})

type CursorPayload = z.infer<typeof cursorPayloadSchema>

/** The shape `s` must have, per kind. `null` is legitimate for any of them — nulls sort last. */
const SORT_VALUE_SCHEMAS: Record<CursorSortKind, z.ZodType<string>> = {
  text: z.string(),
  date: isoDateSchema,
  timestamp: isoDateTimeSchema,
}

export function encodeCursor(cursor: Cursor): string {
  const payload: CursorPayload = { v: 1, s: cursor.sortValue, i: cursor.id }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * Throws `BadRequestError` (→ 400) rather than returning null on a malformed cursor. A cursor a
 * client did not get from us is a bug worth surfacing, not something to paper over by silently
 * serving page one — that would look like the list resetting at random.
 *
 * **400, not the 422 this threw until 2026-07-30.** conventions/api.md §3's table splits the two by
 * *what* failed: 400 is a malformed request, 422 is a well-formed one that violates a business rule.
 * A cursor that does not parse, or whose id is not a uuid, is malformed — there is no rule for it to
 * violate. §4 of that file said 422 because parse failure was the only case it had in mind; both are
 * corrected together.
 *
 * `sortKind` is **required**, and that is the fix's load-bearing part: the value in `s` is compared
 * against a specific column, so nothing can validate it without knowing which. A required parameter
 * makes a forgotten check a compile error in the caller rather than a 500 in production.
 */
export function decodeCursor(raw: string, sortKind: CursorSortKind): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    // Deliberately not rethrowing the JSON/base64 error: it would leak the cursor's internal
    // shape into a client-visible message for no benefit. conventions/code.md §6 forbids
    // swallowing errors, so this converts rather than discards.
    throw new BadRequestError('That pagination cursor is not valid.')
  }

  const payload = cursorPayloadSchema.safeParse(parsed)
  // Converted, not discarded, for the same reason as above — the Zod issues name the internal
  // field letters, so they are logged by the caller's error path and never returned.
  if (!payload.success) throw new BadRequestError('That pagination cursor is not valid.')

  const { s, i } = payload.data
  if (s !== null && !SORT_VALUE_SCHEMAS[sortKind].safeParse(s).success) {
    throw new BadRequestError('That pagination cursor is not valid.')
  }

  return { sortValue: s, id: i }
}

/**
 * The `WHERE` fragment that resumes after `cursor`.
 *
 * Ordering is always `(sortColumn, id)` — **the `id` tie-break is not optional.** Without it,
 * two documents sharing an `expires_on` can straddle a page boundary and one of them is either
 * skipped or repeated, which is the classic keyset bug and it only shows up with real data.
 *
 * Nulls sort **last** in both directions, matching `order by … nulls last` in the query. That
 * is why this takes `nullsLast` as a fixed behaviour rather than an option: the predicate and
 * the `ORDER BY` have to agree, and making it configurable is an invitation for them not to.
 *
 * A cursor's `sortValue` is always a **string** (it has to survive JSON), so it is bound with an
 * explicit cast rather than through Drizzle's column mapper — see `boundSortValue` and
 * `sortableExpr`, both of which are shared with `orderByCursor` so the two cannot disagree.
 */
export function afterCursor(args: {
  sortColumn: AnyPgColumn
  idColumn: AnyPgColumn
  cursor: Cursor
  direction: 'asc' | 'desc'
}): SQL {
  const { sortColumn, idColumn, cursor, direction } = args

  // Already inside the trailing block of nulls: only the id tie-break can advance us, and no
  // non-null row may come back into view.
  if (cursor.sortValue === null) {
    const predicate = and(isNull(sortColumn), gt(idColumn, cursor.id))
    if (predicate === undefined) throw new Error('afterCursor(): empty null-branch predicate')
    return predicate
  }

  const kind = sortValueKind(sortColumn)
  const sortable = sortableExpr(sortColumn, kind)
  const value = boundSortValue(cursor.sortValue, kind)

  const predicate = or(
    direction === 'asc' ? sql`${sortable} > ${value}` : sql`${sortable} < ${value}`,
    and(sql`${sortable} = ${value}`, gt(idColumn, cursor.id)),
    // Nulls come after every non-null value, so they are always still ahead of us here.
    isNull(sortColumn),
  )
  if (predicate === undefined) throw new Error('afterCursor(): empty predicate')
  return predicate
}

/**
 * The expression a page is *sorted and resumed on*, which is not always the bare column.
 *
 * ── Why a `timestamptz` is truncated to milliseconds ──
 *
 * `timestamptz` columns are `mode: 'date'` (`db/columns.ts`), so a row's sort value arrives as a JS
 * `Date` — and `node-postgres` **floors** Postgres's microseconds to build it: `19:33:40.123456+00`
 * becomes `…123Z`. Measured, not assumed. A cursor therefore *cannot* carry the row's exact value,
 * and comparing `created_at > '…123Z'` matches the very row the cursor came from, so **page two
 * repeated the last row of page one** — the classic keyset bug this file warns about, arriving by a
 * different door and hidden until now behind a 500 on the same request.
 *
 * Truncating to the resolution a cursor can actually express fixes it, and the id tie-break then
 * orders rows *within* a millisecond deterministically. Both the predicate and the `ORDER BY` call
 * this one function, which is what makes "they have to agree" structural rather than remembered.
 *
 * Cheaper alternatives were considered and are worse: `timestamptz(3)` columns would be a rewrite of
 * every table for one sort option, and a range predicate that keeps the raw `ORDER BY` skips a row
 * whenever two rows share a millisecond but order differently by id. Nothing is lost on the index
 * side — there is no index on `documents.created_at` for this sort to stop using.
 */
function sortableExpr(column: AnyPgColumn, kind: CursorSortKind): SQL {
  return kind === 'timestamp' ? sql`date_trunc('milliseconds', ${column})` : sql`${column}`
}

/**
 * The cursor's sort value, **bound** (never interpolated) with the cast its column needs.
 *
 * The cast is explicit because the comparison's left side is an expression rather than a column, so
 * Drizzle has no mapper to infer a type from. Binding the string and casting in SQL also side-steps
 * the mapper that made this a 500: a `mode: 'date'` column's mapper calls `.toISOString()` on
 * whatever it is handed, and a cursor hands it a string.
 */
function boundSortValue(value: string, kind: CursorSortKind): SQL {
  switch (kind) {
    case 'text':
      return sql`${value}::text`
    case 'date':
      return sql`${value}::date`
    case 'timestamp':
      return sql`${value}::timestamptz`
    default: {
      // Exhaustive switch with a `never` default (conventions/code.md §5).
      const exhaustive: never = kind
      throw new Error(`boundSortValue(): unhandled kind ${String(exhaustive)}`)
    }
  }
}

/**
 * `order by <sortable> <dir> nulls last, id asc`. The `id` tie-break matches `afterCursor`, and so
 * does the expression — both come from `sortableExpr`, which is the point of that function.
 */
export function orderByCursor(args: {
  sortColumn: AnyPgColumn
  idColumn: AnyPgColumn
  direction: 'asc' | 'desc'
}): SQL[] {
  const { sortColumn, idColumn, direction } = args
  const sortable = sortableExpr(sortColumn, sortValueKind(sortColumn))
  return [
    direction === 'asc' ? sql`${sortable} asc nulls last` : sql`${sortable} desc nulls last`,
    sql`${idColumn} asc`,
  ]
}

/**
 * Turns `limit + 1` rows into a page plus a `next_cursor`.
 *
 * Fetching one extra row is how "is there a next page" is answered without a second `count(*)`
 * — and `next_cursor` is `null` on the last page, never absent (conventions/api.md §4), so
 * "last page" is always explicit rather than inferred from a missing key.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => Cursor,
): { data: T[]; next_cursor: string | null } {
  if (rows.length <= limit) return { data: rows, next_cursor: null }

  const data = rows.slice(0, limit)
  const last = data[data.length - 1]
  // `data` is non-empty here (limit >= 1 and rows.length > limit), but noUncheckedIndexedAccess
  // is on and conventions/code.md §5 forbids `!`.
  if (last === undefined) return { data, next_cursor: null }

  return { data, next_cursor: encodeCursor(cursorOf(last)) }
}
