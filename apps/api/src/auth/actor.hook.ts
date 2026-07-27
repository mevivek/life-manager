import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'
import { ensurePersonalSpace } from '../domains/spaces/spaces.service.js'
import { UnauthorizedError } from '../lib/errors.js'
import { auth } from './auth.js'
import { listMembershipsForUser } from './memberships.repository.js'

/**
 * Session → `ActorContext`, on every request. security-model.md §3.
 *
 * Registered globally, after CORS and rate limiting and before every route. `fp()` here is
 * correct and required: the hook must apply to the whole application, not to one encapsulated
 * subtree.
 */
export const actorHook = fp(
  async (app: FastifyInstance) => {
    app.decorateRequest('actor', null)

    app.addHook('onRequest', async (request) => {
      // No route matched. Let the not-found handler produce a 404 rather than answering an
      // unknown path with a 401, which would be a confusing lie. Nothing is readable here —
      // there is no handler to reach.
      if (request.routeOptions.url === undefined) return

      // conventions/api.md §6: authentication is the default; public is the explicit opt-out.
      // See src/lib/route-config.ts for why this is per-route rather than a path allowlist.
      if (request.routeOptions.config.public === true) return

      /**
       * One call handles BOTH transports — the httpOnly cookie (web) and
       * `Authorization: Bearer` (native, via the bearer plugin) — so no endpoint branches on
       * client type.
       */
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.raw.headers),
      })

      if (session === null) {
        // Thrown, not `reply.code(401)`: error rendering lives in one place (lib/problem.ts).
        throw new UnauthorizedError()
      }

      let memberships = await listMembershipsForUser(session.user.id)

      if (memberships.length === 0) {
        /**
         * Self-heal. A signed-up user with no space means the signup after-hook did not
         * complete — see spaces.service.ts. `warn`, not `debug`: we want this visible if it
         * ever happens, because it is the only evidence that path failed.
         */
        request.log.warn({ userId: session.user.id }, 'session has no space; repairing')
        await ensurePersonalSpace(session.user.id, session.user.name)
        memberships = await listMembershipsForUser(session.user.id)
      }

      const first = memberships[0]
      if (first === undefined) {
        request.log.error({ userId: session.user.id }, 'repair produced no space')
        throw new UnauthorizedError()
      }

      request.actor = {
        userId: session.user.id,
        spaceIds: memberships.map((membership) => membership.spaceId),
        /**
         * At M0 every user has exactly one space, so this is that space's role. See the open
         * question on `ActorContext.role` in actor.ts — a single scalar cannot describe a
         * multi-space membership, and resolving it is M3 work.
         */
        role: first.role,
      }
    })
  },
  { name: 'actor-hook' },
)
