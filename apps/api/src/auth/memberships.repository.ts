import type { SpaceRole } from '@life-manager/shared'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { spaceMembers, users } from '../db/schema/index.js'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  THE ONE REPOSITORY MODULE WHOSE FUNCTIONS DO NOT TAKE AN `actor`.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * conventions/code.md §2 requires `actor: ActorContext` as the first parameter of every
 * repository function, and §10 requires a comment on every deliberate deviation. This is that
 * comment.
 *
 * `listMembershipsForUser` **builds** the actor, so demanding one would be circular. It lives
 * under `src/auth/` rather than `src/domains/spaces/` so that the exception is physically
 * separated from actor-scoped repositories, and a review grep like
 *
 *     rg 'export async function' --glob '*.repository.ts' -A1 | rg -v actor
 *
 * finds it in a file whose name and header explain why.
 *
 * **The `userId` argument must come from a verified session and nothing else.** Never from a
 * request body, a query parameter, or a header. That is the entire trust boundary here.
 */

export type Membership = {
  spaceId: string
  role: SpaceRole
}

/**
 * Read live on every request, deliberately — not cached in the session payload. A cached
 * membership list would survive a revoke at M3, and a stale tenant boundary is a security bug
 * rather than a stale cache.
 */
export async function listMembershipsForUser(userId: string): Promise<Membership[]> {
  return db
    .select({ spaceId: spaceMembers.spaceId, role: spaceMembers.role })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, userId))
    .orderBy(spaceMembers.joinedAt)
}

/**
 * Maintenance only — used by `pnpm db:seed` to repair users with no personal space. Also
 * actor-less, for the same reason a seed script has no session. Do not call it from a route.
 */
export async function listAllUsersForMaintenance(): Promise<{ id: string; name: string }[]> {
  return db.select({ id: users.id, name: users.name }).from(users).orderBy(users.createdAt)
}
