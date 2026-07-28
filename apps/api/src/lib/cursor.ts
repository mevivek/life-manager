import { and, eq, gt, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { ValidationError } from './errors.js'

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
 * base64, not a signed token — so nothing here trusts it for authorization. The worst a forged
 * cursor can do is start the page somewhere odd *within the caller's own space*, because the
 * tenant filter is a separate `AND` that a cursor cannot reach.
 */

/** The decoded cursor. `sortValue` is `null` when the last row's sort column was null. */
export type Cursor = {
  sortValue: string | null
  id: string
}

type CursorPayload = { v: 1; s: string | null; i: string }

export function encodeCursor(cursor: Cursor): string {
  const payload: CursorPayload = { v: 1, s: cursor.sortValue, i: cursor.id }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * Throws `ValidationError` (→ 422) rather than returning null on a malformed cursor. A cursor a
 * client did not get from us is a bug worth surfacing, not something to paper over by silently
 * serving page one — that would look like the list resetting at random.
 */
export function decodeCursor(raw: string): Cursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    // Deliberately not rethrowing the JSON/base64 error: it would leak the cursor's internal
    // shape into a client-visible message for no benefit. conventions/code.md §6 forbids
    // swallowing errors, so this converts rather than discards.
    throw new ValidationError('That pagination cursor is not valid.')
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as CursorPayload).v !== 1 ||
    typeof (parsed as CursorPayload).i !== 'string'
  ) {
    throw new ValidationError('That pagination cursor is not valid.')
  }

  const payload = parsed as CursorPayload
  return { sortValue: typeof payload.s === 'string' ? payload.s : null, id: payload.i }
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
 */
export function afterCursor(args: {
  sortColumn: AnyPgColumn
  idColumn: AnyPgColumn
  cursor: Cursor
  direction: 'asc' | 'desc'
}): SQL {
  const { sortColumn, idColumn, cursor, direction } = args
  const beyond = direction === 'asc' ? gt : lt

  // Already inside the trailing block of nulls: only the id tie-break can advance us, and no
  // non-null row may come back into view.
  if (cursor.sortValue === null) {
    const predicate = and(isNull(sortColumn), gt(idColumn, cursor.id))
    if (predicate === undefined) throw new Error('afterCursor(): empty null-branch predicate')
    return predicate
  }

  const value = cursor.sortValue
  const predicate = or(
    beyond(sortColumn, value),
    and(eq(sortColumn, value), gt(idColumn, cursor.id)),
    // Nulls come after every non-null value, so they are always still ahead of us here.
    isNull(sortColumn),
  )
  if (predicate === undefined) throw new Error('afterCursor(): empty predicate')
  return predicate
}

/** `order by <col> <dir> nulls last, id asc`. The `id` tie-break matches `afterCursor`. */
export function orderByCursor(args: {
  sortColumn: AnyPgColumn
  idColumn: AnyPgColumn
  direction: 'asc' | 'desc'
}): SQL[] {
  const { sortColumn, idColumn, direction } = args
  return [
    direction === 'asc' ? sql`${sortColumn} asc nulls last` : sql`${sortColumn} desc nulls last`,
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
