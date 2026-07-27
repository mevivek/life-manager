import { and, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { ActorContext } from '../auth/actor.js'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  THE TENANT FILTER. One implementation, for the whole codebase.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * conventions/code.md §2 and data.md §3 both require every repository read to filter
 * `space_id IN actor.spaceIds` **and** `deleted_at IS NULL`, and require both to come from one
 * helper "so they cannot drift apart". This is that helper. A repository that hand-writes
 * either predicate is a review finding.
 */

/**
 * Structurally typed on purpose: a table without `spaceId` and `deletedAt` is a **compile**
 * error at the call site, not a runtime surprise. That is what makes security-model.md §3's
 * claim — "not a convention, a type-level requirement" — literally true.
 */
export type SpaceScopedTable = PgTable & {
  spaceId: AnyPgColumn
  deletedAt: AnyPgColumn
}

/**
 * Note for whoever tries to pass `spaces` here: it is deliberately NOT a `SpaceScopedTable`.
 * Its own `id` is the space id and it has no `deleted_at`. Do not widen this type to
 * accommodate it, and do not drop the filter — `spaces.repository.ts` filters
 * `inArray(spaces.id, actor.spaceIds)` explicitly, with a comment.
 */
export function scoped(actor: ActorContext, table: SpaceScopedTable): SQL {
  // An actor with no spaces must match nothing. Drizzle's behaviour for `inArray(col, [])`
  // has changed across versions, and "which rows does an empty IN list match" is far too
  // important to leave to a dependency's release notes. Answer it here.
  if (actor.spaceIds.length === 0) return sql`false`

  const predicate = and(inArray(table.spaceId, [...actor.spaceIds]), isNull(table.deletedAt))

  // `and()` is typed `SQL | undefined` because it accepts undefined members. Neither of ours
  // ever is, so this is unreachable — but it is checked rather than asserted away, because a
  // silently-undefined predicate would mean an unfiltered query.
  if (predicate === undefined) {
    throw new Error('scoped(): tenant predicate came back undefined')
  }

  return predicate
}
