import type { QueryClient } from '@tanstack/react-query'
import { documentsKey } from '@/features/documents/useDocuments'
import { thingsKey } from '@/features/things/useThings'
import * as outbox from './outbox'

/**
 * Runs the outbox when the network comes back.
 *
 * Separate from `outbox.ts` so that module stays a pure queue with no knowledge of React Query or of
 * when it is called — which is what makes it straightforward to test.
 */

/**
 * Guards against overlapping runs.
 *
 * Both the `online` event and a manual trigger can fire within a moment of each other, and two
 * concurrent replays would read the same queue and send every entry twice. The idempotency key means
 * the duplicate is answered from cache rather than applied twice — so this is a belt to the
 * idempotency braces, not the only thing standing between us and double writes.
 */
let running = false

export async function runOutbox(queryClient: QueryClient): Promise<outbox.ReplayResult | null> {
  if (running) return null
  running = true
  try {
    const result = await outbox.replay()

    /**
     * Refetch whatever the replay changed. Even a conflicted run invalidates: the server state is
     * now definitively different from what the cache holds, and the conflict UI needs the real value
     * to show alongside the rejected one.
     *
     * Both roots, unconditionally, rather than only the ones whose entries were in this run. A
     * replayed thing create moves the library's `All` scope, and a replayed document edit can change
     * a thing's `document_count` — the domains are linked, so narrowing this to the kinds that ran
     * would leave the other collection drawing a stale count.
     */
    if (result.sent > 0 || result.conflicted > 0) {
      await queryClient.invalidateQueries({ queryKey: documentsKey })
      await queryClient.invalidateQueries({ queryKey: thingsKey })
    }
    return result
  } finally {
    running = false
  }
}

/**
 * Subscribes to reconnection. Returns an unsubscribe function.
 *
 * Listens for the `online` event rather than polling. Note the caveat from `useOnlineStatus`:
 * `online` means an interface came up, not that the API is reachable — so a replay may immediately
 * fail with `OfflineError`, which `replay()` treats as "stop and stay queued". That is why a false
 * positive here is harmless.
 */
export function startOutboxReplay(queryClient: QueryClient): () => void {
  const onOnline = () => {
    void runOutbox(queryClient)
  }

  window.addEventListener('online', onOnline)

  // Also run once at startup. A tab can be closed while offline with entries queued, and reopened
  // when the network is already back — in which case no `online` event ever fires and the queue
  // would sit there until the next disconnection.
  void runOutbox(queryClient)

  return () => {
    window.removeEventListener('online', onOnline)
  }
}
