import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { meQueryOptions } from '@/features/spaces/useMe'
import { ApiError } from '@/lib/api'

/**
 * Pathless layout route: everything nested under it requires a session.
 *
 * The guard asks the SERVER, via `/api/v1/me`, rather than reading any client-side flag. There
 * is nothing readable to check — the session is an httpOnly cookie — and that is the point
 * (security-model.md §1(3): hiding a button is not a security control). This redirect is purely
 * a UX nicety; the API refuses the data regardless.
 *
 * **This `await` gates the first paint of the entire app**, so two things about it are load-bearing
 * rather than incidental:
 *
 *  - It must run with the persisted cache already restored, or `ensureQueryData` fetches over the
 *    network even when a perfectly good `me` is sitting on disk. `RestoreGate` in `App.tsx` is what
 *    guarantees that; without it every launch waited on the API's cold start behind a blank screen.
 *  - It uses `meQueryOptions`, whose `networkMode: 'offlineFirst'` stops an offline launch hanging
 *    forever on a *paused* fetch. Do not inline the query options here again — the whole point of
 *    the shared object is that this call site and `useMe` cannot drift apart.
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ context, location }) => {
    try {
      await context.queryClient.ensureQueryData(meQueryOptions)
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
