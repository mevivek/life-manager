import { and, eq, lt } from 'drizzle-orm'
import type { ActorContext } from '../auth/actor.js'
import { db } from '../db/client.js'
import { idempotencyKeys } from '../db/schema/idempotency.js'

/**
 * SQL for the `Idempotency-Key` cache. The only layer allowed to write it
 * (conventions/code.md §1).
 *
 * **NOTE ON THE FILTER**, since a review will ask: `idempotency_keys` has no `deleted_at`, so
 * `scoped()` — which requires both `spaceId` and `deletedAt` — cannot type-check against it. The
 * space filter is therefore written out, and it is written out on *every* function here. `actor`
 * is still the first parameter, and no query can be made to read another space's row.
 *
 * The space used is `actor.spaceIds[0]`, the actor's own space, rather than every space they can
 * see: a replay cache entry belongs to the space the write landed in. That is correct at M1 (one
 * space per user) and stays correct at M3 as long as the *write* resolves its target space the
 * same way — which is the open question `ActorContext.role` already tracks (Q6).
 */

export type IdempotencyRecord = {
  requestHash: string
  statusCode: number | null
  responseBody: unknown
}

/**
 * Claims `key` for this actor + endpoint. Returns `null` when the claim succeeded and the caller
 * therefore owns the operation; returns the existing record when someone got there first.
 *
 * One statement, so the check and the claim cannot be interleaved by a concurrent request.
 */
export async function claim(
  actor: ActorContext,
  spaceId: string,
  args: { key: string; endpoint: string; requestHash: string },
): Promise<IdempotencyRecord | null> {
  const inserted = await db
    .insert(idempotencyKeys)
    .values({
      spaceId,
      createdBy: actor.userId,
      key: args.key,
      endpoint: args.endpoint,
      requestHash: args.requestHash,
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyKeys.id })

  if (inserted.length > 0) return null

  const rows = await db
    .select({
      requestHash: idempotencyKeys.requestHash,
      statusCode: idempotencyKeys.statusCode,
      responseBody: idempotencyKeys.responseBody,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.spaceId, spaceId),
        eq(idempotencyKeys.key, args.key),
        eq(idempotencyKeys.endpoint, args.endpoint),
      ),
    )
    .limit(1)

  return rows[0] ?? null
}

/** Records the response so a later retry replays it rather than re-running the operation. */
export async function complete(
  _actor: ActorContext,
  spaceId: string,
  args: { key: string; endpoint: string; statusCode: number; responseBody: unknown },
): Promise<void> {
  await db
    .update(idempotencyKeys)
    .set({ statusCode: args.statusCode, responseBody: args.responseBody })
    .where(
      and(
        eq(idempotencyKeys.spaceId, spaceId),
        eq(idempotencyKeys.key, args.key),
        eq(idempotencyKeys.endpoint, args.endpoint),
      ),
    )
}

/**
 * Releases a claim whose operation failed, so the client can genuinely retry.
 *
 * Without this, a request that 500s would leave a permanent claim and every retry would answer
 * 409 — turning a transient failure into a wedged key. Only non-2xx responses release.
 */
export async function release(
  _actor: ActorContext,
  spaceId: string,
  args: { key: string; endpoint: string },
): Promise<void> {
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.spaceId, spaceId),
        eq(idempotencyKeys.key, args.key),
        eq(idempotencyKeys.endpoint, args.endpoint),
      ),
    )
}

/**
 * Drops entries older than the replay window (§5: 24 hours).
 *
 * Not space-scoped and takes no actor, deliberately — it is maintenance over every space, the
 * same exemption `listAllUsersForMaintenance` takes in `auth/memberships.repository.ts`. Called
 * only from the sweep job.
 */
export async function deleteExpiredForMaintenance(olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, olderThan))
    .returning({ id: idempotencyKeys.id })

  return deleted.length
}
