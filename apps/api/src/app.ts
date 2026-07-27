import Fastify, { type FastifyInstance } from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { actorHook } from './auth/actor.hook.js'
import { authRoutes } from './auth/auth.routes.js'
import { healthRoutes } from './domains/health/health.routes.js'
import { meRoutes } from './domains/me/me.routes.js'
import { loggerOptions } from './lib/logger.js'
import { openapiPlugin } from './lib/openapi.js'
import { registerProblemHandlers } from './lib/problem.js'
import './lib/route-config.js'
import { securityPlugin } from './lib/security.plugin.js'

export type BuildAppOptions = {
  /**
   * Start pg-boss with the app. Defaults to true; tests pass false.
   *
   * Tests must not start it: it would create its schema in every throwaway database, slow
   * every suite, and leave pollers running that fight teardown.
   */
  startJobs?: boolean
}

/**
 * Builds the Fastify instance without listening, so tests can drive it through
 * `app.inject()` (conventions/testing.md §1).
 *
 * **Registration order is significant.** Changing it is a behaviour change:
 *
 * 1. Zod compilers, before any route is declared — a route registered before them is
 *    validated by Fastify's default JSON Schema compiler and its Zod schema is ignored.
 * 2. Problem handlers, so anything failing later renders as problem+json.
 * 3. CORS and rate limiting, before the auth routes. A CORS plugin registered after a route
 *    does not add headers to it, and the CORS hook is what answers the preflight before the
 *    actor hook can reject an `OPTIONS` request for having no session.
 * 4. OpenAPI, before the routes it must document.
 * 5. The actor hook, before any route, so `request.actor` exists for all of them.
 * 6. Routes. `authRoutes` last of the auth pieces, and NOT `fp()`-wrapped — see its file.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  void options.startJobs

  const app = Fastify({
    logger: loggerOptions,
    // Fly terminates TLS and forwards X-Forwarded-*; without this, `request.ip` is the
    // proxy's address and rate limiting keys every user to the same bucket.
    trustProxy: true,
    // conventions/api.md §7: "Unknown query parameters are rejected, not ignored."
    ajv: { customOptions: { removeAdditional: false } },
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  registerProblemHandlers(app)

  await app.register(securityPlugin)
  await app.register(openapiPlugin)
  await app.register(actorHook)

  await app.register(healthRoutes)
  await app.register(meRoutes)
  await app.register(authRoutes)

  // NOTE: the connection pool is deliberately NOT closed here. It is process-wide, whereas a
  // Fastify instance is not — a test file builds and closes several. `server.ts` owns draining
  // it, after `app.close()` returns.

  return app
}
