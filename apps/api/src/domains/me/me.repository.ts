import { eq } from 'drizzle-orm'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { users } from '../../db/schema/index.js'

/**
 * `users` is Better Auth's table, and it has no `space_id` — so `scoped()` does not apply.
 * The filter here is the tightest one possible instead: the actor's own row and nothing else.
 * `actor` is still the first parameter, and the query still cannot be made to read another
 * user's row.
 */
export async function findSelf(
  actor: ActorContext,
): Promise<{ id: string; email: string } | undefined> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.id, actor.userId))
    .limit(1)

  return rows[0]
}
