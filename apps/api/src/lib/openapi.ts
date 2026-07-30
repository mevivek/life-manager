import fastifySwagger from '@fastify/swagger'
import fastifySwaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { createJsonSchemaTransform } from 'fastify-type-provider-zod'
import { env } from '../env.js'

/**
 * OpenAPI 3.1, generated from the same Zod schemas that validate and serialise
 * (ADR-0004), and served at the exact path conventions/api.md §1 pins.
 *
 * Two things here are load-bearing:
 *
 * 1. `zodToJsonConfig.target: 'draft-2020-12'` is what makes the output genuinely 3.1. The
 *    plain `jsonSchemaTransform` export emits 3.0-flavoured JSON Schema, which would make
 *    the `openapi: "3.1.0"` field a lie.
 * 2. The raw document is served from our own route rather than only through swagger-ui,
 *    because api.md §1 fixes the machine-readable path at `/api/v1/openapi.json`
 *    regardless of whether a browsable UI is mounted.
 *
 * The browsable UI (`@fastify/swagger-ui`) is served at `/api/v1/docs` in every environment,
 * including production — a deliberate choice: the schema it renders is no more exposed than
 * `/api/v1/openapi.json` already is (also unauthenticated, also public), and this is a
 * personal API with one real user. Its "try it out" panel fires requests with whatever
 * session cookie the browser holds, same as any REST client the user already has.
 *
 * Known gap, stated so a future mobile-client session does not waste an afternoon: Better
 * Auth's own endpoints do NOT appear in this document. `@fastify/swagger` can only see
 * routes Fastify declared with a schema, and the auth routes are a single catch-all handled
 * inside the library. Registered as debt (docs/product/review.md D13).
 */
export const openapiPlugin = fp(
  async (app: FastifyInstance) => {
    await app.register(fastifySwagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'life-manager API',
          version: '1',
          description:
            'Personal life-management API. Errors are RFC 9457 application/problem+json.',
        },
        servers: [{ url: env.API_BASE_URL }],
        components: {
          securitySchemes: {
            sessionCookie: {
              type: 'apiKey',
              in: 'cookie',
              name: 'better-auth.session_token',
              description: 'Web clients. httpOnly, Secure, SameSite=Lax.',
            },
            bearerToken: {
              type: 'http',
              scheme: 'bearer',
              description: 'Native clients. Same session store as the cookie.',
            },
          },
        },
        // Authentication is the default; individual routes opt out with `security: []`.
        security: [{ sessionCookie: [] }, { bearerToken: [] }],
      },
      transform: createJsonSchemaTransform({
        zodToJsonConfig: { target: 'draft-2020-12' },
      }),
    })

    app.get(
      '/api/v1/openapi.json',
      { schema: { hide: true }, config: { public: true } },
      async () => app.swagger(),
    )

    // A child context: swagger-ui's own routes carry no `config`, and the actor hook
    // treats a missing `config.public` as "requires a session" (conventions/api.md §6).
    // The `onRoute` hook stamps every route this plugin registers as public before the
    // actor hook ever sees it.
    await app.register(async (docs) => {
      docs.addHook('onRoute', (routeOptions) => {
        routeOptions.config = { ...routeOptions.config, public: true }
      })
      await docs.register(fastifySwaggerUi, { routePrefix: '/api/v1/docs' })
    })
  },
  { name: 'openapi' },
)
