import { QueryClient } from '@tanstack/react-query'
import { ApiError, OfflineError } from './api'

/**
 * conventions/code.md §9: server state lives in TanStack Query and is never copied into
 * `useState` — that is how two devices get out of sync, which is the one thing this app must not
 * do.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retrying a 401 or a 404 just delays the redirect and triples the log noise. An
        // `OfflineError` is equally pointless to retry — the connection is the problem, and
        // `refetchOnReconnect` already handles the moment it comes back.
        retry: (failureCount, error) => {
          if (error instanceof OfflineError) return false
          if (error instanceof ApiError && error.status < 500) return false
          return failureCount < 2
        },
        staleTime: 30_000,
        // Phones suspend tabs constantly; refetching on focus is how the list stays honest.
        refetchOnWindowFocus: true,

        /**
         * Queries keep the DEFAULT `networkMode: 'online'`, deliberately.
         *
         * Offline, that leaves a query paused rather than failing, so the rehydrated cache stays on
         * screen instead of being replaced by an error — which is the entire point of
         * [ADR-0013](../../../../docs/decisions/0013-read-only-offline-v1.md)'s read cache. Contrast
         * the mutation setting below, where the same default is actively wrong.
         */
      },

      mutations: {
        /**
         * **`networkMode: 'always'` is load-bearing, not a tweak.**
         *
         * TanStack Query's default (`'online'`) *pauses* a mutation fired while offline and replays
         * it on reconnect. That is an offline write queue — with no version check, no conflict
         * detection and no user-visible pending state — which is precisely what ADR-0013 rejects:
         * "Queue writes and replay them naively on reconnect ... Rejected as actively dangerous —
         * it silently overwrites whatever changed on the server in the meantime."
         *
         * `'always'` makes the mutation fire regardless, so offline it fails immediately with an
         * `OfflineError` whose message states plainly that nothing was saved. The ADR's requirement
         * is "mutations while offline fail with a clear message and are not queued", and this is the
         * line that delivers the "not queued" half.
         *
         * `lib/persister.ts` carries the same rule at the storage layer via
         * `shouldDehydrateMutation: () => false`, so a paused mutation cannot survive a reload
         * either. Both are needed: this one stops the pause, that one stops it persisting.
         */
        networkMode: 'always',

        // Never retry a write automatically. Retrying a non-idempotent request risks applying it
        // twice; where a retry IS safe, conventions/api.md §5 says the caller sends an
        // `Idempotency-Key` and asks again explicitly.
        retry: false,
      },
    },
  })
}
