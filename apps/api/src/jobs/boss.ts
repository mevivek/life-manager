// Named export, not default: pg-boss 12 dropped the default export.
import { PgBoss } from 'pg-boss'
import { env } from '../env.js'
import { logger } from '../lib/logger.js'

/**
 * The job queue, on the same Postgres as everything else (ADR-0012). No Redis.
 *
 * Two configuration details, both of which will bite silently if changed:
 *
 * 1. **`DATABASE_URL_UNPOOLED`.** pg-boss uses `LISTEN`/`NOTIFY` and session-level advisory
 *    locks. Neon's pooled endpoint is PgBouncer in *transaction* mode, where neither is
 *    available: a session lock acquired on one backend and released on another leaks forever.
 *    The app uses the pooled URL; pg-boss must not.
 * 2. **`schema: 'pgboss'`.** Keeps ~10 tables out of `public`, and — more importantly — keeps
 *    them out of drizzle-kit's diff. Without it a pre-v1 `db:push` would see them as drift and
 *    offer to drop the job queue. `drizzle.config.ts` also sets `schemaFilter: ['public']`;
 *    both halves of that pair matter.
 */
let instance: PgBoss | undefined

export function getBoss(): PgBoss {
  if (instance === undefined) {
    instance = new PgBoss({
      connectionString: env.DATABASE_URL_UNPOOLED,
      schema: 'pgboss',
      // One Fly machine; keep the queue's own pool small so it does not compete with the app's.
      max: 2,
    })

    // pg-boss emits asynchronous failures on the instance. Unhandled, they are invisible —
    // conventions/code.md §6 forbids exactly that.
    instance.on('error', (error: unknown) => {
      logger.error({ err: error }, 'pg-boss error')
    })
  }

  return instance
}

/** Test/reset hook. Not for application code. */
export function resetBossForTests(): void {
  instance = undefined
}
