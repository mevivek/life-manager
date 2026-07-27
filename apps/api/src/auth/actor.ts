import type { SpaceRole } from '@life-manager/shared'
import type { FastifyRequest } from 'fastify'
import { UnauthorizedError } from '../lib/errors.js'

/**
 * The tenant-isolation primitive. security-model.md §3.
 *
 * Every repository function takes one of these as its first parameter and filters
 * `space_id IN actor.spaceIds`. **Never construct one by hand outside the auth hook or a
 * test fixture** (conventions/code.md §2) — an `ActorContext` assembled anywhere else is a
 * tenant boundary assembled by whoever was writing that line.
 */
export type ActorContext = {
  /** Authenticated user id, from the session. */
  readonly userId: string

  /**
   * Every space this user is a member of, read live from `space_members` on each request —
   * never from the session payload or anything a client sent. A cached membership would
   * survive an M3 revoke, which is a security bug rather than a stale cache.
   */
  readonly spaceIds: readonly string[]

  /**
   * OPEN QUESTION, to settle at M3. security-model.md §3 defines this as "role in the space
   * being acted upon", but `spaceIds` is a list — the two cannot both be right once a user
   * belongs to two spaces. At M0 every user has exactly one space, so this is that space's
   * role. The likely fix is `memberships: ReadonlyArray<{ spaceId, role }>` with the role
   * resolved per target space, which is an edit to security-model.md §3 and therefore a
   * human decision. Recorded in docs/product/open-questions.md.
   */
  readonly role: SpaceRole
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Null on public routes and before the actor hook has run. Route handlers should call
     * `requireActor(request)` rather than reading this, which keeps `!` out of the codebase
     * (conventions/code.md §5) while still failing loudly if a route is reachable without a
     * session.
     */
    actor: ActorContext | null
  }
}

/**
 * The accessor every protected route handler uses.
 *
 * On a route that did not opt out of authentication, the actor hook guarantees this is set,
 * so the throw is defence in depth against a route being made public by accident — it turns
 * "leaked unauthenticated data" into "401".
 */
export function requireActor(request: FastifyRequest): ActorContext {
  if (request.actor === null) {
    request.log.error(
      { url: request.url },
      'requireActor on a route with no actor — the route is public but reads data',
    )
    throw new UnauthorizedError()
  }
  return request.actor
}
