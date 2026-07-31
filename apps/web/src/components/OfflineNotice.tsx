import { useQueryClient } from '@tanstack/react-query'
import { useOnlineStatus } from '@/lib/useOnlineStatus'

/**
 * The "this might be out of date" banner.
 *
 * [ADR-0013](../../../../docs/decisions/0013-read-only-offline-v1.md) does not merely permit stale
 * data, it *requires* the app to say so: "Cached data is visibly marked as potentially stale, with
 * the time it was fetched." The ADR is blunt about why — the read cache exists so you can check a
 * passport number in a queue with no signal, and an expiry date that has since been renewed is worse
 * than a blank screen, because nothing on screen tells the user which they are looking at.
 *
 * **One banner in the shell, not a badge per list.** The dashboard renders several independent
 * queries; a per-query marker would put three or four "saved 2 hours ago" labels on one screen, all
 * saying the same thing. The fetch time shown is the OLDEST across the persisted queries, because
 * the honest claim is about the least fresh thing visible, not the freshest.
 */

/** `Intl.RelativeTimeFormat`, picking the largest unit that still reads naturally. */
function formatAge(ms: number): string {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return formatter.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return formatter.format(-hours, 'hour')
  return formatter.format(-Math.round(hours / 24), 'day')
}

export function OfflineNotice() {
  const isOnline = useOnlineStatus()
  const queryClient = useQueryClient()

  // Only while offline. Online, TanStack Query refetches on focus and on reconnect, so a staleness
  // warning would be both noisy and usually wrong by the time it was read.
  if (isOnline) return null

  /**
   * The oldest `dataUpdatedAt` among queries that actually hold data. `dataUpdatedAt` is 0 for a
   * query that has never resolved, which would otherwise date the whole cache to 1970.
   */
  const timestamps = queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.data !== undefined && query.state.dataUpdatedAt > 0)
    .map((query) => query.state.dataUpdatedAt)

  const oldest = timestamps.length > 0 ? Math.min(...timestamps) : null

  return (
    <div
      // `role="status"` not `role="alert"`: being offline is a condition to report, not an error to
      // interrupt for. An alert steals focus from whatever the user was reading.
      role="status"
      // Ledger tokens, not the pre-Ledger shadcn utilities this shipped with (design.md §1, §3): a
      // `--radius-*` token rather than `rounded-md`, and `text-body` rather than `text-sm` — 14px is
      // below §3's 15px floor and, being outside the `--text-*` scale, does not move with the density
      // preference either. This banner sits above every authed screen, so it was the most-seen thing
      // in the app still wearing another design system.
      className="flex items-center gap-2 rounded-3 border border-rule bg-sunken px-4 py-3 text-body leading-snug text-ink-2"
    >
      <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-ink-3" />
      <span>
        Offline
        {oldest === null ? (
          '.'
        ) : (
          <>
            {' — showing what was saved '}
            <time dateTime={new Date(oldest).toISOString()}>{formatAge(Date.now() - oldest)}</time>
          </>
        )}
        . Edits are queued and sent when you reconnect; deleting needs a connection.
      </span>
    </div>
  )
}
