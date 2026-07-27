import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { getBoss } from './boss.js'
import { registerJobs } from './index.js'

/**
 * Starts pg-boss with the app and stops it with the app.
 *
 * `onReady`, not at module load: pg-boss creates its schema and starts pollers on `start()`,
 * and doing that while the app is still assembling means a failure surfaces as an unhandled
 * rejection instead of as a failed boot.
 *
 * Tests pass `startJobs: false`, and must: starting it would create the `pgboss` schema in every
 * throwaway database, add seconds to every suite, and leave pollers running that fight teardown.
 */
export const jobsPlugin = fp(
  async (app: FastifyInstance) => {
    const boss = getBoss()

    app.addHook('onReady', async () => {
      await boss.start()
      await registerJobs(boss)
      app.log.info('pg-boss started')
    })

    app.addHook('onClose', async () => {
      // `graceful` lets in-flight handlers finish, `close` drains pg-boss's own pool, and
      // `timeout` bounds it so a stuck handler cannot hold shutdown open. Fly sends SIGTERM on
      // every scale-to-zero, so this path runs constantly rather than rarely.
      // (pg-boss 12's StopOptions is { close, graceful, timeout } — there is no `wait`.)
      await boss.stop({ graceful: true, close: true, timeout: 5_000 })
      app.log.info('pg-boss stopped')
    })
  },
  { name: 'jobs' },
)
