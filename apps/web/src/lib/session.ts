import type { QueryClient } from '@tanstack/react-query'
import { meQueryKey } from '@/features/spaces/useMe'
import { signOut } from './auth-client'
import { purgePersistedCache } from './persister'

/**
 * The two session boundaries, in one place because both of them have to purge the on-disk cache and
 * neither is obvious from its call site.
 *
 * Before `lib/persister.ts` existed, `queryClient.clear()` was sufficient: the cache was memory-only
 * and a reload emptied it. Now the cache outlives the tab, so every path that changes *who* is
 * looking at the app has to delete it explicitly. security-model.md §4 puts "another user of the
 * system" and "a stolen phone" in Tier 0's threat model, and a persisted document list is squarely
 * within reach of both.
 */

/**
 * Sign out, then destroy every trace of the session's data locally.
 *
 * The clear happens in a `finally`: a sign-out attempted with no connectivity will reject, and the
 * local cache must still be destroyed. Leaving a readable document list on the device because the
 * network call failed is the wrong failure mode — the user asked to sign out, and the one thing that
 * is fully within our control is the local copy.
 *
 * Order matters. `clear()` first, so that if the persister's throttled write lands after the delete
 * below, the only thing it can possibly write is an empty cache.
 */
export async function endSession(queryClient: QueryClient): Promise<void> {
  try {
    await signOut()
  } finally {
    queryClient.clear()
    await purgePersistedCache()
  }
}

/**
 * Called after a successful sign-in or sign-up, BEFORE navigating into the authed area.
 *
 * This is the belt-and-braces half, and it is not redundant. `endSession` covers the ordinary
 * sign-out, but nothing runs when a tab is closed mid-sign-out or when a session simply expires
 * server-side. In either case the previous user's documents are still in IndexedDB, and the next
 * sign-in would rehydrate and *display* them: invalidating `me` alone only refetches `me`, so the
 * document lists would render from the restored cache while their refetch was still in flight.
 */
export async function beginSession(queryClient: QueryClient): Promise<void> {
  await purgePersistedCache()
  queryClient.clear()
  await queryClient.invalidateQueries({ queryKey: meQueryKey })
}
