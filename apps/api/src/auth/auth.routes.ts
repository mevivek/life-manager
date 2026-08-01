import { authProvidersResponseSchema, problemSchema } from '@life-manager/shared'
import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { env, isTest } from '../env.js'
import { auth, isGoogleConfigured } from './auth.js'

/**
 * Mounts Better Auth at `/api/v1/auth/*`.
 *
 * **This plugin is deliberately NOT wrapped in `fastify-plugin`.** It must stay encapsulated,
 * because it installs a catch-all `*` content-type parser and the rest of the API is JSON-only
 * (conventions/api.md §8). `fp()` would remove the encapsulation and apply that parser
 * globally.
 *
 * Why a raw buffer rather than Fastify's JSON parser: the official integration example does
 * `JSON.stringify(request.body)`, which works for email/password and then silently breaks the
 * first time an endpoint expects `application/x-www-form-urlencoded` — OAuth callbacks, and
 * some plugin routes. Passing the bytes through untouched has no such class of failure.
 *
 * There is no `@better-auth/fastify` package. The community `fastify-better-auth` wrapper
 * exists; a route we own is less rot risk than a third-party wrapper around the auth layer.
 */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  // `removeAllContentTypeParsers()` FIRST, and it is not optional. Fastify's `'*'` catch-all
  // only handles content types that have no registered parser, and `application/json` has a
  // built-in one — so without this line a JSON body arrives as a parsed OBJECT, gets passed to
  // `new Request({ body })`, stringifies as "[object Object]", and Better Auth answers every
  // signup with `400 Invalid JSON in request body`. Encapsulated, so the rest of the API keeps
  // its JSON parser.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
    done(null, body)
  })

  /**
   * `GET /api/v1/auth/providers` — what this deployment can sign you in with (ADR-0035).
   *
   * **Declared BEFORE the `/api/v1/auth/*` catch-all below, and it wins regardless of order**:
   * find-my-way ranks a static segment above a wildcard, so `providers` never reaches Better Auth.
   * Declared first anyway, so reading this file top to bottom does not suggest otherwise.
   *
   * **Public by necessity, not by preference.** It is read *before* anyone has a session — that is the
   * whole point of it. What it discloses is two booleans about configuration, which is already visible
   * to anyone who looks at the sign-in page.
   *
   * Unlike the catch-all it is NOT `schema: { hide: true }`: this is a route we own with a contract in
   * `packages/shared`, so it belongs in `/api/v1/openapi.json` (debt D13 is about Better Auth's own
   * library-shaped paths, which this is not).
   */
  app.withTypeProvider<ZodTypeProvider>().get(
    '/api/v1/auth/providers',
    {
      config: {
        public: true,
        // The same tight auth bucket as the routes below: this sits in front of the sign-in screen
        // and an unauthenticated endpoint with a loose limit is a free amplifier.
        rateLimit: { max: isTest ? 1_000 : 20, timeWindow: '1 minute' },
      },
      schema: {
        operationId: 'getAuthProviders',
        summary: 'Which sign-in methods this deployment offers',
        tags: ['system'],
        security: [],
        response: {
          200: authProvidersResponseSchema,
          429: problemSchema,
        },
      },
    },
    async () => ({
      // NOT a second copy of the env check — `isGoogleConfigured` is the same value `auth.ts` builds
      // `socialProviders` from. See the comment on it there.
      google: isGoogleConfigured,
      /**
       * Constant `true`, and deliberately not a config read. ADR-0035 removes email+password from the
       * *screens*, never from the server: it is the recovery path if a Google account is lost, and
       * `emailAndPassword.enabled` in `auth.ts` is hard-coded `true` for that reason. The field exists
       * so the client never has to assume.
       */
      password: true,
    }),
  )

  app.route({
    method: ['GET', 'POST'],
    url: '/api/v1/auth/*',
    config: {
      // Better Auth authenticates its own requests; the actor hook must not demand a session
      // to reach the login endpoint.
      public: true,
      // conventions/api.md §10 / security-model.md §6: auth endpoints get a much tighter limit
      // than ordinary reads. This is where credential stuffing shows up.
      //
      // Raised in tests rather than disabled, so the limiter stays in the code path being
      // exercised: a fixture that signs up half a dozen users must not trip it.
      rateLimit: { max: isTest ? 1_000 : 20, timeWindow: '1 minute' },
    },
    // Hidden from OpenAPI: the library shapes these paths, so a stub entry would be a
    // half-truth. See the note in auth.ts.
    schema: { hide: true },
    async handler(request, reply) {
      const url = new URL(request.url, env.API_BASE_URL)

      const webRequest = new Request(url, {
        method: request.method,
        // `fromNodeHeaders`, never a hand-built Headers object: cookie and multi-value headers
        // get mangled otherwise.
        headers: fromNodeHeaders(request.raw.headers),
        ...(request.method === 'GET' || request.body === undefined
          ? {}
          : { body: request.body as Buffer }),
      })

      const response = await auth.handler(webRequest)

      reply.status(response.status)

      for (const [key, value] of response.headers) {
        // Skipped here and handled below: iterating Headers COMBINES multiple Set-Cookie
        // values into one comma-joined string, which produces a single malformed cookie. This
        // is the line that makes login work.
        if (key.toLowerCase() === 'set-cookie') continue
        reply.header(key, value)
      }
      const setCookie = response.headers.getSetCookie()
      if (setCookie.length > 0) reply.header('set-cookie', setCookie)

      return reply.send(response.body === null ? null : await response.text())
    },
  })
}
