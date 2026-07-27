import { inject } from 'vitest'

/**
 * Runs once per test FILE, before that file's module graph is imported. That ordering is the
 * whole point: `src/env.ts` snapshots `process.env` at import time, so the real database URL
 * has to be in place before anything imports it.
 *
 * `vitest.config.ts` seeds an obviously-fake placeholder URL so `env.ts` parses even in suites
 * that never touch a database; this replaces it with the throwaway database that
 * `global-setup.ts` obtained.
 */
const databaseUrl = inject('databaseUrl')

if (databaseUrl !== null) {
  process.env.DATABASE_URL = databaseUrl
  // Same database. pg-boss and drizzle-kit want the direct endpoint in production; against a
  // local container there is only one endpoint.
  process.env.DATABASE_URL_UNPOOLED = databaseUrl
}
