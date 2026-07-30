import { createHash, timingSafeEqual } from 'node:crypto'
import type { MaintenanceRunResponse } from '@life-manager/shared'
import { withTryAdvisoryLock } from '../../db/advisory-lock.js'
import { env } from '../../env.js'
import { runRemindersInline, sweepAbandoned } from '../../jobs/reminders.js'
import { NotConfiguredError, UnauthorizedError } from '../../lib/errors.js'
import { logger } from '../../lib/logger.js'

/**
 * The daily maintenance run, and the door in front of it. ADR-0028.
 *
 * This is the one endpoint in the API with **no session and no actor**, so the authorisation story is
 * unusually load-bearing and lives here rather than being spread across a hook. Everything it touches
 * is cross-space by design (`*ForMaintenance` repository functions), which is exactly why it must not
 * be reachable without the secret.
 */

/**
 * Advisory-lock key. Arbitrary but **fixed forever** — a changed number serialises nothing against
 * processes still using the old one. Deliberately distinct from `MIGRATION_LOCK_KEY` in `migrate.ts`;
 * two unrelated jobs sharing a key would block each other for no reason.
 *
 * Exported only so the test can take the lock itself and assert the skip path deterministically. Two
 * concurrent `runDailyMaintenance()` calls race — whichever connects first can finish before the other
 * even asks — and a test that depends on that ordering fails about one run in ten.
 */
export const MAINTENANCE_LOCK_KEY = 40172028

/**
 * Constant-time secret comparison.
 *
 * **`===` would be a bug, not a style choice**: string comparison short-circuits at the first
 * differing byte, so response time leaks how much of the secret a guess got right. That is the
 * textbook case `timingSafeEqual` exists for.
 *
 * The SHA-256 step is what makes it usable on values of *unknown* length. `timingSafeEqual` throws on
 * length mismatch, so comparing raw inputs would either crash on a short header or require a length
 * check that leaks the length. Hashing both sides first gives two 32-byte buffers whatever came in.
 * This is not hand-rolling crypto (invariant 8) — it is the documented idiom, built from `node:crypto`
 * primitives with no invention in between.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest()
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(providedDigest, expectedDigest)
}

/**
 * Throws unless the caller presented the right secret.
 *
 * Order matters: **not-configured is checked before the secret**, so a deployment with no
 * `CRON_SECRET` answers 503 rather than 401. 401 would say "your key is wrong" about a deployment
 * that has no key at all, which sends whoever is debugging it to the scheduler instead of to the
 * service config.
 */
export function authorizeMaintenanceRequest(provided: string | undefined): void {
  const expected = env.CRON_SECRET

  if (expected === undefined) {
    throw new NotConfiguredError(
      'The maintenance trigger is not configured on this deployment. Set CRON_SECRET.',
    )
  }

  // Absent header handled here rather than by a Zod `required` on the schema: a missing key and a
  // wrong key must be indistinguishable to the caller, and a Zod failure would be a 400 that says so.
  if (provided === undefined || !secretsMatch(provided, expected)) {
    // Nothing about the expected value, and nothing about the provided one, reaches the log.
    logger.warn('maintenance trigger rejected: missing or incorrect X-Cron-Key')
    throw new UnauthorizedError('Invalid or missing trigger credential.')
  }
}

/**
 * Runs the scan, the deliveries and the sweep, under an advisory lock.
 *
 * **The lock is not theoretical.** Cloud Scheduler retries a non-2xx response and enforces its own
 * attempt deadline, so a run slower than that deadline can be retried while the first is still
 * sending. Both would see the same `sent_at is null` rows and both would push — a duplicate
 * notification for every due reminder. `pg_try_advisory_lock` makes the second one a no-op.
 */
export async function runDailyMaintenance(): Promise<MaintenanceRunResponse> {
  const startedAt = Date.now()

  const outcome = await withTryAdvisoryLock(MAINTENANCE_LOCK_KEY, async () => {
    const reminders = await runRemindersInline()
    // After the deliveries, never before: the sweep soft-deletes orphaned reminders, and running it
    // first would race the scan for the same rows. The gap that `index.ts` opened with an hour between
    // two cron schedules is closed here by ordering instead.
    const swept = await sweepAbandoned()
    return { reminders, swept: swept.reminders }
  })

  if (!outcome.acquired) {
    logger.warn('maintenance run skipped: another run holds the lock')
    return {
      status: 'skipped_locked',
      // No scan happened, so there is no date to echo and no counts to report. Zeroes with an
      // explicit `skipped_locked` status beats omitting the fields and making every client optional.
      today: '',
      found: 0,
      delivered: 0,
      undelivered: 0,
      errored: 0,
      swept: 0,
      duration_ms: Date.now() - startedAt,
    }
  }

  const { reminders, swept } = outcome.value

  return {
    status: 'ran',
    today: reminders.today,
    found: reminders.found,
    delivered: reminders.delivered,
    undelivered: reminders.undelivered,
    errored: reminders.errored,
    swept,
    duration_ms: Date.now() - startedAt,
  }
}
