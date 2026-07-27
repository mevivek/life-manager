import fastifyCors from '@fastify/cors'
import fastifyRateLimit from '@fastify/rate-limit'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { env } from '../env.js'
import { PROBLEM_CONTENT_TYPE, rateLimitProblem } from './problem.js'

/**
 * CORS and rate limiting. Registered FIRST in `app.ts`, before the auth routes — a CORS
 * plugin registered after a route does not add headers to that route's responses, and the
 * failure looks like a browser bug rather than a config error.
 *
 * conventions/api.md §10 and security-model.md §6.
 */
export const securityPlugin = fp(
  async (app: FastifyInstance) => {
    await app.register(fastifyCors, {
      // Exact origins, never `*`. `credentials: true` with a wildcard origin is rejected
      // by every browser, and the session cookie would never be sent. An array so the
      // deployed app and localhost can both be trusted — see originListSchema in env.ts.
      origin: env.WEB_ORIGIN,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['content-type', 'authorization', 'idempotency-key'],
      maxAge: 86400,
    })

    await app.register(fastifyRateLimit, {
      // Generous global default. Auth routes set their own, much tighter, per-route limit.
      max: 300,
      timeWindow: '1 minute',

      // Keyed by user when we know who they are, by IP when we do not. The rate limiter's
      // onRequest hook runs before the actor hook, so `request.actor` is null for the first
      // request of a session and it falls back to IP — which is the correct behaviour for
      // unauthenticated traffic anyway.
      keyGenerator: (request) => request.actor?.userId ?? request.ip,

      // Without this the 429 would be the one error in the API that is not problem+json.
      errorResponseBuilder: (request, context) => {
        const retryAfterSeconds = Math.ceil(context.ttl / 1000)
        return rateLimitProblem(request, retryAfterSeconds)
      },
    })

    // @fastify/rate-limit sets the body but not the content type.
    app.addHook('onSend', async (_request, reply, payload) => {
      if (reply.statusCode === 429) reply.type(PROBLEM_CONTENT_TYPE)
      return payload
    })
  },
  { name: 'security' },
)
