import { Client } from 'pg'
import { inject } from 'vitest'
import { migrate } from '../db/migrate.js'

/**
 * Runs once per test FILE, before that file's module graph is imported. That ordering is the
 * whole point: `src/env.ts` snapshots `process.env` at import time, so the real database URL has
 * to be in place before anything imports it.
 *
 * ── Why each worker gets its OWN database ──
 *
 * conventions/testing.md §5 requires tests to pass "in any order and in parallel", and
 * isolation here comes from `truncate` (see db.ts). Those two are incompatible on a single
 * shared database: with `fileParallelism` on, one file's `beforeEach` truncate deletes the
 * users another file is mid-test with. That failure mode is intermittent and looks like flaky
 * auth rather than like a harness bug, which is the worst kind.
 *
 * So the URL that `global-setup.ts` provides is treated as an ADMIN url, and each Vitest worker
 * gets `<basename>_w<workerId>`, created on first use and migrated. Files sharing a worker run
 * sequentially, so truncation between them is safe.
 *
 * Consequence for the `TEST_DATABASE_URL` path: extra `*_w1`, `*_w2`… databases appear on that
 * server. Documented in `.env.example` — point it at a throwaway.
 */
const adminUrl = inject('databaseUrl')

if (adminUrl !== null) {
  const workerId = process.env.VITEST_WORKER_ID ?? '1'
  const workerUrl = new URL(adminUrl)
  const baseName = workerUrl.pathname.replace(/^\//, '') || 'postgres'
  const workerDatabase = `${baseName}_w${workerId}`
  // A database name cannot be a bound parameter, so it is interpolated below. Nothing
  // attacker-controlled reaches it — but assert the shape anyway rather than relying on that
  // staying true (security-model.md §6).
  if (!/^[A-Za-z0-9_]+$/.test(workerDatabase)) {
    throw new Error(`refusing unsafe test database name: ${workerDatabase}`)
  }
  workerUrl.pathname = `/${workerDatabase}`

  await ensureDatabase(adminUrl, workerDatabase)
  await migrate(workerUrl.toString())

  process.env.DATABASE_URL = workerUrl.toString()
  // Same database. pg-boss and drizzle-kit want the direct endpoint in production; against a
  // local server there is only one endpoint.
  process.env.DATABASE_URL_UNPOOLED = workerUrl.toString()
}

async function ensureDatabase(url: string, name: string): Promise<void> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    // `create database` cannot run inside a transaction and has no `if not exists`, so the
    // "already exists" code is the expected path on every run after the first.
    await client.query(`create database "${name}"`)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code !== '42P04') throw error
  } finally {
    await client.end()
  }
}
