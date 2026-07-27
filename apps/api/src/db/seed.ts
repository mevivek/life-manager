import { listAllUsersForMaintenance } from '../auth/memberships.repository.js'
import { ensurePersonalSpace } from '../domains/spaces/spaces.service.js'
import { logger } from '../lib/logger.js'
import { closePool } from './client.js'

/**
 * `pnpm --filter api db:seed`
 *
 * ADR-0011 makes resetting the dev database routine, and requires a maintained seed script so
 * that resetting is cheap. **Idempotent — run it as many times as you like.**
 *
 * There is no fixture data to insert at M0: no domain table exists, and creating a user means
 * going through Better Auth's password hashing, which a seed script has no business
 * reimplementing (sign up through the app instead). So what it does is *repair*: give every
 * user their personal space if they somehow lack one, and report what it found.
 *
 * When M1 adds `documents`, this is where a few realistic fixtures go.
 */
async function seed(): Promise<void> {
  const users = await listAllUsersForMaintenance()
  logger.info({ users: users.length }, 'seeding')

  for (const user of users) {
    const spaceId = await ensurePersonalSpace(user.id, user.name)
    logger.info({ userId: user.id, spaceId }, 'personal space ensured')
  }

  logger.info({ users: users.length }, 'seed complete')
}

try {
  await seed()
} finally {
  await closePool()
}
