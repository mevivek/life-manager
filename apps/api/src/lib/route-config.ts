/**
 * Per-route configuration flags.
 *
 * conventions/api.md §6: "Authentication is the default; public is the exception — a new
 * route is protected unless it explicitly opts out." That is expressed as a route-level
 * `config.public` flag rather than a central path allowlist, because a central list can be
 * forgotten in a way that fails OPEN (a new path silently matching a wildcard entry),
 * whereas forgetting this flag fails CLOSED: the route requires a session.
 *
 * The complete set of public routes is greppable:
 *
 *     rg 'public: true' apps/api/src
 *
 * At M0 there are exactly three: /api/v1/health, /api/v1/openapi.json, /api/v1/auth/*.
 */
declare module 'fastify' {
  interface FastifyContextConfig {
    /** When true, the actor hook does not require a session for this route. */
    public?: boolean
  }
}

export {}
