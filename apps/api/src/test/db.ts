import { sql } from 'drizzle-orm'
import { beforeEach, describe, inject } from 'vitest'
import { db } from '../db/client.js'

/**
 * Helpers for suites that need a real Postgres.
 *
 * Import `describeDb` instead of `describe`. When no database is available the suite skips
 * with its name still listed, which is visibly different from the suite not existing — see
 * `global-setup.ts` for why that is a skip and not a failure (ADR-0018).
 */

const databaseUrl = inject('databaseUrl')

export const hasTestDatabase = databaseUrl !== null

export const describeDb: typeof describe | typeof describe.skip = hasTestDatabase
  ? describe
  : describe.skip

/**
 * Every table, child-first. `cascade` makes the order redundant but not wrong, and listing
 * them explicitly means adding a table and forgetting this line shows up as a test that
 * pollutes the next one rather than as mystery flakiness.
 *
 * Truncation, not a transaction-rollback wrapper: `spacesService.ensurePersonalSpace()` opens
 * its own transaction (conventions/code.md §8 — services own transactions), and a rollback
 * wrapper cannot contain that.
 *
 * Raw SQL outside a repository, which conventions/code.md §1 forbids in application code. This
 * is test infrastructure, not application code, and there is no actor to scope it to — the
 * point is to remove *every* space's rows.
 */
export async function truncateAll(): Promise<void> {
  await db.execute(
    sql`truncate table reminders, push_subscriptions, document_files, documents,
                       thing_photos, thing_services, things,
                       idempotency_keys, space_members, spaces,
                       sessions, accounts, verifications, users
        restart identity cascade`,
  )
}

/** Call at the top of a `describeDb` block. No shared mutable state between tests (§5). */
export function withCleanDatabase(): void {
  beforeEach(async () => {
    await truncateAll()
  })
}
