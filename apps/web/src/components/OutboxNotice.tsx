import { Link } from '@tanstack/react-router'
import { useOutbox } from '@/features/outbox/useOutbox'

/**
 * Tells you there are writes waiting, or writes that need a decision (ADR-0024).
 *
 * **A conflict that is stored but not shown is a conflict that has silently lost data**, as far as the
 * user can tell — they made an edit, nothing said otherwise, and it never arrived. The outbox
 * deliberately keeps a rejected write instead of discarding it; this is the half that makes keeping
 * it mean something.
 *
 * Rendered in the app shell alongside `OfflineNotice`, and only when there is something to say. The
 * conflict state takes priority and is styled as destructive: pending writes resolve themselves on
 * reconnect and need no action, whereas a conflict will sit there forever until you choose.
 */
export function OutboxNotice() {
  const { pending, conflicts } = useOutbox()

  if (conflicts.length > 0) {
    return (
      <Link
        to="/outbox"
        className="flex items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm"
      >
        <span>
          {conflicts.length === 1
            ? '1 change needs your attention'
            : `${conflicts.length} changes need your attention`}
        </span>
        <span aria-hidden="true" className="shrink-0 text-muted-foreground">
          Review →
        </span>
      </Link>
    )
  }

  if (pending.length > 0) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
      >
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
        <span>
          {pending.length === 1
            ? '1 change waiting to send'
            : `${pending.length} changes waiting to send`}
          . They will be sent when you are back online.
        </span>
      </div>
    )
  }

  return null
}
