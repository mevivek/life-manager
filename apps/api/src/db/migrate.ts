import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

/**
 * Applies the committed migrations in `apps/api/drizzle/`.
 *
 * Three callers, all of which go through `migrate.cli.ts` or import `migrate()` directly:
 * `pnpm db:migrate` locally, `fly.toml`'s `release_command` on deploy, and the test harness.
 * The test harness matters most — running the real migration files against a
 * throwaway database on every `pnpm test` is what stops debt D7 ("migration path never
 * exercised") from being completely true.
 *
 * A single `Client`, not a pool, and the DIRECT connection string: `create index` and friends
 * take locks that do not belong in a pooled, multiplexed session, and Neon's pooler is
 * PgBouncer in transaction mode.
 */

const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle')

export async function migrate(connectionString: string): Promise<void> {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await drizzleMigrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER })
  } finally {
    await client.end()
  }
}
