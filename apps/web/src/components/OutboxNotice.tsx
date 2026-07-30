import { Link } from '@tanstack/react-router'
import { useOutbox } from '@/features/outbox/useOutbox'
import { useOnlineStatus } from '@/lib/useOnlineStatus'

/**
 * Tells you there are writes waiting, or writes that need a decision (ADR-0024).
 *
 * **A conflict that is stored but not shown is a conflict that has silently lost data**, as far as the
 * user can tell — they made an edit, nothing said otherwise, and it never arrived. The outbox
 * deliberately keeps a rejected write instead of discarding it; this is the half that makes keeping
 * it mean something.
 *
 * Rendered in the app shell alongside `OfflineNotice`, and only when there is something to say. The
 * conflict state takes priority: pending writes resolve themselves on reconnect and need no action,
 * whereas a conflict will sit there forever until you choose.
 *
 * ── How the conflict state is allowed to be loud ──
 *
 * It shipped as `bg-destructive/10 border-destructive/50` — a red-tinted block mixed from the
 * destructive alias with opacity modifiers. design.md §4 rules that out twice over: **destructive is
 * text in `--status-late`, never a filled red block**, and a colour must come from a token rather than
 * from an alpha channel applied to one. The sanctioned way to say "past its date" on a ground is the
 * status *tint* — `--status-late-bg`, which is what `Alert variant="destructive"` and a detail
 * screen's `STATUS_BG` both use — with a hairline and ordinary ink on top. So the tint carries the
 * urgency and the words stay readable, which is also the only way this survives at 390px in dark mode
 * where a 10% red over near-black is indistinguishable from the paper.
 */
export function OutboxNotice() {
  const { pending, conflicts } = useOutbox()
  const isOnline = useOnlineStatus()

  if (conflicts.length > 0) {
    return (
      <Link
        to="/outbox"
        className="flex items-center justify-between gap-3 rounded-3 border border-rule-2 bg-status-late-bg px-4 py-3 text-body leading-snug text-ink"
      >
        <span className="font-medium">
          {conflicts.length === 1
            ? '1 change needs your attention'
            : `${conflicts.length} changes need your attention`}
        </span>
        {/* The affordance, not the message — quieter ink so the sentence is what reads first. */}
        <span aria-hidden="true" className="shrink-0 text-meta text-ink-2">
          Review →
        </span>
      </Link>
    )
  }

  if (pending.length > 0) {
    /**
     * **Only promise "when you are back online" if we are actually offline.**
     *
     * The banner used to say that unconditionally, which produced the report that prompted this
     * change: a phone showing full signal and full wifi, sitting under a message insisting the
     * writes would go out once the connection returned. The connection had never left. A message
     * the user cannot act on, and cannot disprove, is worse than no message.
     */
    const label =
      pending.length === 1
        ? '1 change waiting to send'
        : `${pending.length} changes waiting to send`

    return (
      <Link
        to="/outbox"
        role="status"
        className="flex items-center justify-between gap-3 rounded-3 border border-rule bg-sunken px-4 py-3 text-body leading-snug text-ink-2"
      >
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="size-2 shrink-0 rounded-pill bg-ink" />
          <span>
            {label}
            {isOnline ? '.' : '. They will be sent when you are back online.'}
          </span>
        </span>
        {/* Tappable now. Previously only the conflict banner linked anywhere, so a stuck queue was
            something you could see and not inspect. */}
        <span aria-hidden="true" className="shrink-0 text-meta">
          View →
        </span>
      </Link>
    )
  }

  return null
}
