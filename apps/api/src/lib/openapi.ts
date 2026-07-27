import fastifySwagger from '@fastify/swagger'
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
 * 2. We serve the document from our own route rather than adding `@fastify/swagger-ui`,
 *    because api.md §1 fixes the path at `/api/v1/openapi.json`. No browsable UI at M0.
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
  },
  { name: 'openapi' },
)
