import { healthResponseSchema, problemSchema } from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { env } from '../../env.js'

/**
 * `GET /api/v1/health` — public, and deliberately does NOT query Postgres.
 *
 * Neon scales compute to zero. A health check that opened a connection would either wake the
 * database on every probe (burning the free-tier compute hours that debt D8 is already
 * watching) or report unhealthy while it was asleep. This endpoint answers one question:
 * "is the API process up and serving?"
 *
 * It also answers a second one the client cannot answer alone: **which build is serving.** The two
 * halves deploy independently, so `version` and `built_at` here are what the You screen compares
 * against the bundle's own. See `healthResponseSchema` for why `uptime_seconds` is not the answer.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    '/api/v1/health',
    {
      config: { public: true },
      schema: {
        operationId: 'getHealth',
        summary: 'Liveness check',
        tags: ['system'],
        security: [],
        response: {
          200: healthResponseSchema,
          429: problemSchema,
        },
      },
    },
    async () => ({
      status: 'ok' as const,
      version: env.APP_VERSION,
      // How long THIS INSTANCE has been awake — not how long this build has been deployed. On
      // scale-to-zero the two are unrelated; `built_at` is the deploy time and may be null.
      uptime_seconds: Math.round(process.uptime()),
      built_at: env.BUILD_TIME ?? null,
    }),
  )
}
