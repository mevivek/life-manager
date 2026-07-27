import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '../env.js'
import { logger } from '../lib/logger.js'
import * as schema from './schema/index.js'

/**
 * The one database connection in the process. CLAUDE.md invariant 1: nothing outside
 * `apps/api` may hold a database URL, and inside it, nothing but this module opens a pool.
 *
 * `node-postgres`, not `@neondatabase/serverless`: this is a long-lived process on Fly, so a
 * real TCP pool beats HTTP-per-query. The serverless driver is for edge runtimes that cannot
 * hold a socket.
 *
 * The POOLED Neon endpoint (ADR-0005). pg-boss and drizzle-kit deliberately use the direct
 * one instead — see env.ts.
 */
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  // Neon's pooler multiplexes for us; a large client-side pool just holds idle PgBouncer
  // slots. One Fly machine, one modest pool.
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

// An idle client erroring (Neon suspending compute, a network blip) emits on the pool, not on
// a query. Unhandled, it takes the process down. conventions/code.md §6: never swallow, but
// this one is recoverable — pg discards the client and the next query gets a fresh one.
pool.on('error', (error) => {
  logger.error({ err: error }, 'idle postgres client errored')
})

export const db = drizzle(pool, {
  schema,
  // Belt and braces. Every column already declares its snake_case name explicitly
  // (conventions/data.md §7); this means a forgotten one still maps correctly rather than
  // creating a camelCase column in Postgres.
  casing: 'snake_case',
})

export type Db = typeof db

let poolClosed = false

/**
 * Called by `server.ts` after `app.close()`, and by `db:seed`. Deliberately NOT registered as a
 * Fastify `onClose` hook: the pool is process-wide while a Fastify instance is not, and a test
 * file that builds two apps would otherwise end the pool underneath the second one.
 *
 * Idempotent, because `pg` throws "Called end on pool more than once".
 */
export async function closePool(): Promise<void> {
  if (poolClosed) return
  poolClosed = true
  await pool.end()
}
