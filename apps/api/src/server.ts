import { buildApp } from './app.js'
import { closePool } from './db/client.js'
import { migrate } from './db/migrate.js'
import { env } from './env.js'
import { logger } from './lib/logger.js'

/**
 * Process entry point. `buildApp()` is separate so tests can build an instance without
 * binding a port — which is also why migrations run *here* rather than in `buildApp`: the test
 * harness applies them itself, per worker, and must not have a second path doing it.
 *
 * Shutdown is not a rare path here: Cloud Run stops the instance when it goes idle and starts it
 * again on the next request (ADR-0021), so SIGTERM runs constantly. `app.close()` fires the
 * `onClose` hooks, which stop pg-boss and drain the pg pool in registration order.
 */

const SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Applies migrations before serving. ADR-0023.
 *
 * **Nothing else does.** `fly.toml`'s `release_command` was the mechanism until
 * [ADR-0021](../../docs/decisions/0021-cloud-run-for-the-api.md) moved the API to Cloud Run and
 * took it away; `cloudbuild.deploy.yaml` never gained a replacement. M0 survived that only because
 * its schema had been applied by hand, and M1 would have shipped an API reporting healthy while
 * every documents endpoint 500'd on a missing table — `/health` does not touch the database, so
 * neither the pipeline's own check nor the deploy verifier would have noticed.
 *
 * **On the UNPOOLED URL.** DDL takes locks that do not survive PgBouncer's transaction pooling,
 * and the advisory lock in `migrate()` is session-level — a pooled session could release it on a
 * different backend than took it.
 *
 * Failing here means the process exits and the revision never becomes healthy, so Cloud Run keeps
 * serving the previous one. That is the right failure mode: a bad migration should stop a deploy,
 * not half-apply and serve.
 */
async function applyMigrations(): Promise<void> {
  if (env.SKIP_MIGRATIONS_ON_BOOT) {
    logger.warn('SKIP_MIGRATIONS_ON_BOOT is set — starting without applying migrations')
    return
  }

  const startedAt = Date.now()
  logger.info('applying migrations')
  await migrate(env.DATABASE_URL_UNPOOLED)
  logger.info({ ms: Date.now() - startedAt }, 'migrations applied')
}

async function main(): Promise<void> {
  await applyMigrations()

  const app = await buildApp()

  let shuttingDown = false
  const shutdown = (signal: string): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down')

    // If a connection or a job refuses to finish, exit anyway rather than hanging until the
    // platform kills the machine with SIGKILL and no log line.
    const failsafe = setTimeout(() => {
      logger.error({ signal }, 'shutdown timed out; exiting')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    failsafe.unref()

    app
      .close()
      // The pool is process-wide, not per-instance, so it is drained here rather than in an
      // `onClose` hook. See db/client.ts.
      .then(closePool)
      .then(() => {
        logger.info('shutdown complete')
        process.exit(0)
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'shutdown failed')
        process.exit(1)
      })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))

  await app.listen({ port: env.PORT, host: env.HOST })
  logger.info({ port: env.PORT, host: env.HOST, env: env.NODE_ENV }, 'api listening')
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start')
  process.exit(1)
})
