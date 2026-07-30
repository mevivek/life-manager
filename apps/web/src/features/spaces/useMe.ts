import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** The query key everything auth-dependent should be invalidated against on sign-out. */
export const meQueryKey = ['me'] as const

/**
 * ONE definition of the `me` query, shared by the hook below and by `routes/_authed.tsx`'s guard.
 *
 * Written once rather than twice because the two call sites must agree on `networkMode`, and a pair
 * of hand-written option objects is exactly how they would quietly stop agreeing.
 *
 * **`networkMode: 'offlineFirst'` is the fix for a blank offline launch, not a preference.** The
 * default `'online'` *pauses* a fetch while offline instead of failing it — correct for a component's
 * `useQuery`, which should keep showing rehydrated data (see the note in `lib/query-client.ts`), and
 * actively wrong here: `_authed`'s `beforeLoad` **awaits** this query, so a paused fetch is a promise
 * that never settles and a screen that stays blank forever. Measured, not theorised —
 * `lib/startup.test.tsx` pins it.
 *
 * `'offlineFirst'` attempts the request once regardless. With a restored cache `ensureQueryData`
 * returns the cached value and never fetches at all; with no cache and no connection it fails fast
 * with an `OfflineError`, which the guard turns into a legible error screen rather than a hang.
 */
export const meQueryOptions = queryOptions({
  queryKey: meQueryKey,
  queryFn: api.me,
  networkMode: 'offlineFirst',
})

export function useMe() {
  return useQuery(meQueryOptions)
}
