import { Client } from 'pg'
import { env } from '../env.js'

/**
 * Runs `fn` while holding a Postgres advisory lock, or reports that someone else holds it.
 *
 * `migrate.ts` does this inline for migrations and blocks (`pg_advisory_lock`), because the second
 * process there *should* wait and then find nothing to do. This one **tries and gives up**, because
 * the caller is a scheduler: a second concurrent run has nothing useful to wait for, and telling it
 * "already running" immediately is better than holding an HTTP request open until the first finishes.
 *
 * ── Why a dedicated Client on the UNPOOLED url ──
 *
 * Session-level advisory locks do not survive PgBouncer in transaction mode, which is what Neon's
 * pooled endpoint is: the lock would be taken on one backend and released on another, leaking
 * forever. The same trap is documented on `jobs/boss.ts` and in `env.ts`. The alternative —
 * `pg_try_advisory_xact_lock` on the app's pool — would work, but only for the lifetime of one
 * transaction, and this lock has to span a series of outbound Web Push requests that have no business
 * being inside a database transaction.
 */
export type LockOutcome<T> = { acquired: true; value: T } | { acquired: false }

export async function withTryAdvisoryLock<T>(
  key: number,
  fn: () => Promise<T>,
): Promise<LockOutcome<T>> {
  const client = new Client({ connectionString: env.DATABASE_URL_UNPOOLED })
  await client.connect()

  try {
    const result = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [key],
    )

    if (result.rows[0]?.locked !== true) return { acquired: false }

    try {
      return { acquired: true, value: await fn() }
    } finally {
      // `client.end()` in the outer `finally` drops the lock anyway — released explicitly so the
      // intent is legible, and so a later change to connection handling cannot silently hold it.
      await client.query('select pg_advisory_unlock($1)', [key])
    }
  } finally {
    await client.end()
  }
}
