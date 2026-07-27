import { buildApp } from './app.js'
import { env } from './env.js'
import { logger } from './lib/logger.js'

/**
 * Process entry point. `buildApp()` is separate so tests can build an instance without
 * binding a port.
 *
 * Shutdown is not a rare path here: Fly stops the machine when it goes idle and starts it
 * again on the next request (ADR-0014), so SIGTERM runs constantly. `app.close()` fires the
 * `onClose` hooks, which stop pg-boss and drain the pg pool in registration order.
 */

const SHUTDOWN_TIMEOUT_MS = 10_000

async function main(): Promise<void> {
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
