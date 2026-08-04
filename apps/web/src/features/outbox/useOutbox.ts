import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { documentsKey } from '@/features/documents/useDocuments'
import { thingsKey } from '@/features/things/useThings'
import * as outbox from '@/lib/outbox'
import { runOutbox } from '@/lib/outbox-replay'

/**
 * Reactive view of the offline write queue (ADR-0024).
 *
 * The queue is in IndexedDB, not React state, so nothing re-renders when it changes. This bridges
 * the two: a `useQuery` for the read, and `outbox.subscribe` to invalidate it when the queue moves.
 * Polling would be the alternative and would be wrong — the queue changes on user action and on
 * reconnect, both of which are events we already have.
 *
 * **The `['outbox']` key is deliberately NOT in the persist allowlist** (`lib/persister.ts`). The
 * outbox has its own IndexedDB key and is its own source of truth; caching a snapshot of it in the
 * query cache as well would mean two copies that can disagree about whether a write is still pending.
 */
export const outboxKey = ['outbox'] as const

export function useOutbox() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: outboxKey,
    queryFn: () => outbox.list(),
    // The queue is local; there is no network cost and no staleness to manage beyond the
    // subscription below.
    staleTime: 0,
  })

  useEffect(
    () =>
      outbox.subscribe(() => {
        void queryClient.invalidateQueries({ queryKey: outboxKey })
      }),
    [queryClient],
  )

  const entries = query.data ?? []
  return {
    entries,
    pending: entries.filter((entry) => entry.status === 'pending'),
    conflicts: entries.filter((entry) => entry.status === 'conflict'),
  }
}

/**
 * The two ways to resolve a conflict. There is no third, and in particular no merge.
 *
 * Both invalidate the document queries afterwards: whichever way it goes, what the server holds is
 * now different from what the cache last saw.
 */
export function useResolveConflict() {
  const queryClient = useQueryClient()

  // Both roots: a conflict can now be a thing's edit as well as a document's, and the resolution
  // changes what the server holds either way.
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: documentsKey })
    await queryClient.invalidateQueries({ queryKey: thingsKey })
  }

  return {
    /** Discard my edit and accept what the server has. */
    discard: async (id: string) => {
      await outbox.remove(id)
      await invalidate()
    },

    /**
     * Re-apply my edit on top of the server's current version, then send it immediately.
     *
     * `currentVersion` comes from a fresh read of the document, not from the queued entry — the whole
     * reason the entry was refused is that its own version is stale.
     */
    keepMine: async (id: string, currentVersion: number) => {
      await outbox.retryWithVersion(id, currentVersion)
      await runOutbox(queryClient)
      await invalidate()
    },
  }
}
