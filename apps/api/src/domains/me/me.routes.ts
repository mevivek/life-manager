import { meResponseSchema, problemSchema } from '@life-manager/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { requireActor } from '../../auth/actor.js'
import { getMe } from './me.service.js'

/**
 * `GET /api/v1/me` — the endpoint M0's acceptance criterion is proved against.
 *
 * roadmap.md: "done when you can sign up on your phone, and the API proves the session
 * resolves to an `ActorContext` with exactly one space." The `spaces` array in this response is
 * rendered from `request.actor`, which the actor hook builds from a live `space_members` query.
 * Seeing one space here IS that proof.
 *
 * No `config.public`, so it requires a session. That is the default, not a setting.
 */
export async function meRoutes(app: FastifyInstance): Promise<void> {
  const route = app.withTypeProvider<ZodTypeProvider>()

  route.get(
    '/api/v1/me',
    {
      schema: {
        operationId: 'getMe',
        summary: 'The authenticated user and the spaces they belong to',
        tags: ['identity'],
        response: {
          200: meResponseSchema,
          401: problemSchema,
          404: problemSchema,
          429: problemSchema,
        },
      },
    },
    async (request) => getMe(requireActor(request)),
  )
}
