import { z } from 'zod'

/**
 * `GET /api/v1/health` — public, and deliberately does not touch the database. A health
 * check that fails when Postgres is asleep would make Neon's scale-to-zero look like an
 * outage.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptime_seconds: z.number().nonnegative(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
