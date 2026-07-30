import { maintenanceRunResponseSchema, problemSchema } from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { isTest } from '../../env.js'
import * as service from './maintenance.service.js'

/**
 * `POST /api/v1/maintenance::run-daily` — the external trigger for the daily reminder scan.
 * [ADR-0028](../../../../../docs/decisions/0028-external-trigger-for-the-daily-scan.md).
 *
 * ── Three things about this route are unusual, and all three are deliberate ──
 *
 * **1. `config: { public: true }`, on an endpoint that touches every space.** `public` here means
 * only "the actor hook does not require a session" — it does not mean unauthenticated. The caller is
 * Cloud Scheduler, which has no user and no cookie, so it authenticates with a shared secret checked
 * by `authorizeMaintenanceRequest` as the first thing the handler does. Read `route-config.ts` before
 * concluding this is a hole: the flag fails *closed* for routes that forget it, and this one does not
 * forget its own check.
 *
 * **2. `::` in the registration string, and the verb after a STATIC segment.** `maintenance` is
 * static, which is what makes the `:verb` form legal here at all — conventions/api.md §2 and the long
 * block comment in `documents.routes.ts` explain why a colon after a *parameter* silently generates a
 * broken OpenAPI path. The URL Cloud Scheduler calls is the single-colon
 * `/api/v1/maintenance:run-daily`.
 *
 * **3. A tight rate limit, like the auth routes.** The global default is 300/minute, which is
 * absurdly generous for something meant to be called once a day, and this is the one route where a
 * guessable credential is the only thing standing between a caller and every user's notifications.
 * Brute-forcing 32 bytes is not the realistic threat; making the endpoint cheap to hammer is.
 */
export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.post(
    '/api/v1/maintenance::run-daily',
    {
      config: {
        public: true,
        rateLimit: { max: isTest ? 1_000 : 6, timeWindow: '1 minute' },
      },
      schema: {
        operationId: 'runDailyMaintenance',
        summary: 'Run the daily reminder scan and sweep',
        description:
          'Authenticated by the `X-Cron-Key` header, not a session — the caller is a scheduler. ' +
          'Answers 503 when CRON_SECRET is unset, so an unconfigured deployment is closed rather ' +
          'than open. Does the scan, the deliveries and the sweep synchronously, because a ' +
          'scale-to-zero instance has no worker to drain a queue (ADR-0028).',
        tags: ['system'],
        /**
         * Declared so the header appears in the OpenAPI document, but NOT as `required`. A Zod
         * rejection would be a 400 that distinguishes "no key" from "wrong key"; the service answers
         * both with the same 401 instead.
         */
        headers: z.object({ 'x-cron-key': z.string().optional() }),
        response: {
          200: maintenanceRunResponseSchema,
          401: problemSchema,
          429: problemSchema,
          503: problemSchema,
        },
        // No session, so the global bearer/cookie security requirement does not apply.
        security: [],
      },
    },
    async (request) => {
      service.authorizeMaintenanceRequest(request.headers['x-cron-key'])
      return service.runDailyMaintenance()
    },
  )
}
