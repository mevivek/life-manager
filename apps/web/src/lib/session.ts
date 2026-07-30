import type { QueryClient } from '@tanstack/react-query'
import { meQueryKey } from '@/features/spaces/useMe'
import { signOut } from './auth-client'
import * as outbox from './outbox'
import { purgePersistedCache, resumePersisting } from './persister'

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
 * below, the only thing it can possibly write is an empty cache. That is now the *second* line of
 * defence rather than the only one — `purgePersistedCache()` seals writes outright, because the
 * reasons this ordering worked turned out to be three layers deep in a dependency. See `sealed` in
 * lib/persister.ts. Keep the ordering anyway: it costs nothing and it is what makes the payload
 * harmless in the window before the seal is set.
 */
export async function endSession(queryClient: QueryClient): Promise<void> {
  try {
    await signOut()
  } finally {
    queryClient.clear()
    // The outbox goes too. A pending write belongs to the session that made it, and replaying one
    // user's queued edit under the next user's session would be both wrong and confusing — the
    // server would either refuse it as cross-space (404, per invariant 4) or, worse, apply it if the
    // two shared a space.
    await Promise.all([purgePersistedCache(), outbox.clear()])
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
  await Promise.all([purgePersistedCache(), outbox.clear()])
  queryClient.clear()
  await queryClient.invalidateQueries({ queryKey: meQueryKey })
  // LAST, and not by accident — `purgePersistedCache` above sealed writes, and the reasoning for why
  // this line belongs here rather than three lines up is on `resumePersisting` in lib/persister.ts.
  resumePersisting()
}
