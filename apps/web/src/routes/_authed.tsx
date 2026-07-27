import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { meQueryKey } from '@/features/spaces/useMe'
import { ApiError, api } from '@/lib/api'

/**
 * Pathless layout route: everything nested under it requires a session.
 *
 * The guard asks the SERVER, via `/api/v1/me`, rather than reading any client-side flag. There
 * is nothing readable to check — the session is an httpOnly cookie — and that is the point
 * (security-model.md §1(3): hiding a button is not a security control). This redirect is purely
 * a UX nicety; the API refuses the data regardless.
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData({ queryKey: meQueryKey, queryFn: api.me })
    } catch (error) {
      if (error instanceof ApiError && error.isUnauthenticated) {
        throw redirect({ to: '/login', search: { redirect: location.href } })
      }
      // Anything else — the API being down, a contract mismatch — must surface, not silently
      // look like "logged out" (conventions/code.md §6).
      throw error
    }
  },
  component: Outlet,
})
