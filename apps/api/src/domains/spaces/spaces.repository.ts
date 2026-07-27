import type { SpaceMembership } from '@life-manager/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { ActorContext } from '../../auth/actor.js'
import { type Db, db } from '../../db/client.js'
import { spaceMembers, spaces } from '../../db/schema/index.js'

/**
 * SQL for `spaces` and `space_members`. The only layer allowed to write it
 * (conventions/code.md §1).
 */

/** A transaction handle, or the pool. Services pass a `tx`; nothing else should. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * `GET /api/v1/me`'s data. Takes `actor` first and filters by it, as every repository
 * function must.
 *
 * NOTE ON THE FILTER: this reads `spaces`, which is deliberately NOT a `SpaceScopedTable` —
 * its own `id` IS the space id, and it has no `deleted_at`. So `scoped()` cannot apply here
 * and the predicate is written out: `spaces.id IN actor.spaceIds`, plus the membership row
 * belonging to this actor. Do not "fix" this by widening `SpaceScopedTable`, and do not drop
 * the filter. See src/db/scoped.ts.
 */
export async function listForActor(actor: ActorContext): Promise<SpaceMembership[]> {
  if (actor.spaceIds.length === 0) return []

  const rows = await db
    .select({
      spaceId: spaces.id,
      name: spaces.name,
      kind: spaces.kind,
      role: spaceMembers.role,
      joinedAt: spaceMembers.joinedAt,
    })
    .from(spaceMembers)
    .innerJoin(spaces, eq(spaces.id, spaceMembers.spaceId))
    .where(and(eq(spaceMembers.userId, actor.userId), inArray(spaces.id, [...actor.spaceIds])))
    .orderBy(spaceMembers.joinedAt)

  // camelCase → snake_case happens here, at the Drizzle boundary, and nowhere else
  // (conventions/api.md §8).
  return rows.map((row) => ({
    space_id: row.spaceId,
    name: row.name,
    kind: row.kind,
    role: row.role,
    joined_at: row.joinedAt.toISOString(),
  }))
}

/**
 * ── DELIBERATE DEVIATION from "every repository function takes `actor` first" ──
 *
 * The three functions below run during signup, for a user who has no spaces yet and therefore
 * cannot have an `ActorContext` — requiring one would be circular. conventions/code.md §10
 * requires this comment. They are callable only from `spaces.service.ts`, they take an
 * explicit `userId`, and they never accept one from a request body.
 */

export async function findPersonalSpaceId(
  executor: Executor,
  userId: string,
): Promise<string | undefined> {
  const rows = await executor
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.personalForUserId, userId))
    .limit(1)

  return rows[0]?.id
}

/**
 * Inserts the personal space, or does nothing if one already exists. The `on conflict do
 * nothing` lands on `spaces_personal_for_user_id_key`, the partial unique index from
 * conventions/data.md §9 — which is what makes two concurrent calls safe rather than
 * racy.
 *
 * Returns undefined when the conflict fired, i.e. somebody else got there first.
 */
export async function insertPersonalSpace(
  executor: Executor,
  userId: string,
  name: string,
): Promise<string | undefined> {
  const rows = await executor
    .insert(spaces)
    .values({ name, kind: 'personal', personalForUserId: userId })
    .onConflictDoNothing()
    .returning({ id: spaces.id })

  return rows[0]?.id
}

export async function insertOwnerMembership(
  executor: Executor,
  spaceId: string,
  userId: string,
): Promise<void> {
  await executor
    .insert(spaceMembers)
    .values({ spaceId, userId, role: 'owner' })
    .onConflictDoNothing()
}
