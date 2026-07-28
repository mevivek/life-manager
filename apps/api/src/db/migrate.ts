import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

/**
 * Applies the committed migrations in `apps/api/drizzle/`.
 *
 * Three callers: `pnpm db:migrate` locally, **the API on boot** (`server.ts`), and the test
 * harness. The test harness matters most for confidence — running the real migration files
 * against a throwaway database on every `pnpm test` is what stops debt D7 ("migration path never
 * exercised") from being completely true.
 *
 * **`server.ts` is the caller that matters for deployment**, and it was missing until M1. The
 * Dockerfile and this file both used to say migrations were applied by `fly.toml`'s
 * `release_command` — which stopped being true the moment [ADR-0021] moved the API to Cloud Run,
 * leaving nothing at all applying them. M0 only worked because its schema had been pushed by hand.
 * See ADR-0023.
 *
 * A single `Client`, not a pool, and the DIRECT connection string: `create index` and friends
 * take locks that do not belong in a pooled, multiplexed session, and Neon's pooler is
 * PgBouncer in transaction mode.
 */

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

/**
 * Advisory-lock key. Arbitrary but **fixed forever** — every process that migrates must use the
 * same number or the lock does not serialise anything.
 */
const MIGRATION_LOCK_KEY = 40172026

/** How long to wait for another instance's migration before giving up loudly. */
const LOCK_TIMEOUT = '60s'

export async function migrate(connectionString: string): Promise<void> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    /**
     * **A session-level advisory lock, because more than one process can run this at once.**
     *
     * Cloud Run is configured `--max-instances=3`, and migrations now run on boot — so two cold
     * starts can call this simultaneously. Drizzle's migrator does not serialise itself: both
     * would read an empty `__drizzle_migrations`, both would apply the same `create table`, and
     * the loser gets `relation already exists` and fails to boot.
     *
     * `pg_advisory_lock` blocks, which is the behaviour we want — the second instance should wait
     * and then find there is nothing left to do. `lock_timeout` bounds that wait so a genuinely
     * stuck migration surfaces as a failed boot rather than an instance hanging until Cloud Run's
     * start deadline, which reports as something much less specific.
     *
     * Session-level rather than transaction-level (`pg_advisory_xact_lock`): Drizzle opens its own
     * transaction internally, so a xact lock would be released when *its* transaction commits
     * rather than when the whole migration run finishes.
     */
    await client.query(`set lock_timeout = '${LOCK_TIMEOUT}'`)
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])

    try {
      await drizzleMigrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
    } finally {
      // `client.end()` below would drop the lock anyway; released explicitly so the intent is
      // legible and so a future change to connection handling cannot silently hold it.
      await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    await client.end()
  }
}
