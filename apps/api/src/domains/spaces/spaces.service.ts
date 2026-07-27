import { db } from '../../db/client.js'
import { logger } from '../../lib/logger.js'
import {
  findPersonalSpaceId,
  insertOwnerMembership,
  insertPersonalSpace,
} from './spaces.repository.js'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  "Every user gets a personal space at signup, with themselves as owner." — ADR-0006
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0006 and ADR-0007 originally said signup "transactionally creates" the space. Better
 * Auth cannot literally do that, and the ADR has been amended to say what is actually
 * guaranteed. The finding, for the record:
 *
 *   - `databaseHooks.user.create.after` is queued to run AFTER the user-insert transaction
 *     commits, by design (better-auth #7260). An after-hook that inserts a row referencing
 *     the new user inside that transaction hits a foreign-key violation, because it cannot
 *     see the uncommitted row.
 *   - A `before` hook cannot work either: `space_members.user_id` needs the user to exist.
 *   - Getting a genuine single transaction would mean forking Better Auth's signup or
 *     hand-writing the auth-table inserts. Both are far worse trades.
 *
 * So the guarantee is delivered by three things instead of one transaction:
 *
 *   1. The space and its owner membership are created in ONE transaction here, so no user
 *      ever has an orphan space or a space with no owner.
 *   2. A partial unique index on `spaces (personal_for_user_id)` makes a second personal
 *      space impossible, so this function is idempotent under concurrency — not just in code.
 *   3. Two independent callers invoke it: the signup after-hook, and the actor hook when it
 *      finds a session with no memberships. If the first ever dies between commit and hook,
 *      the user's next request repairs it.
 *
 * Net: every user ends up with exactly one personal space they own. The mechanism is a
 * constraint plus idempotent retry, not atomicity with user creation.
 */

/** Keeps within `spaces.name`'s 120-character limit without truncating mid-surrogate. */
function personalSpaceName(userName: string): string {
  const trimmed = userName.trim()
  const base = trimmed === '' ? 'Personal' : `${trimmed}'s space`
  return [...base].slice(0, 120).join('')
}

/**
 * Idempotent. Returns the id of the user's personal space, creating it if absent.
 *
 * Owns its own transaction, because services own transactions (conventions/code.md §8).
 */
export async function ensurePersonalSpace(userId: string, userName: string): Promise<string> {
  return db.transaction(async (tx) => {
    const existing = await findPersonalSpaceId(tx, userId)
    if (existing !== undefined) {
      // Repair the case where the space exists but the membership insert failed last time.
      await insertOwnerMembership(tx, existing, userId)
      return existing
    }

    const inserted = await insertPersonalSpace(tx, userId, personalSpaceName(userName))

    // `undefined` means the partial unique index rejected the insert, i.e. a concurrent call
    // created it first. Re-read rather than treating a lost race as an error.
    const spaceId = inserted ?? (await findPersonalSpaceId(tx, userId))
    if (spaceId === undefined) {
      throw new Error(`ensurePersonalSpace: no personal space for user after insert`)
    }

    await insertOwnerMembership(tx, spaceId, userId)
    logger.info({ userId, spaceId }, 'personal space created')
    return spaceId
  })
}
