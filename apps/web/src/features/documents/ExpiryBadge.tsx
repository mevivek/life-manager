import { cn } from '@/lib/utils'

/**
 * The expiry badge from domains/documents.md §7.
 *
 * This is the one piece of UI that carries the domain's whole point — "is it still valid, and when
 * do I need to do something about it?" — so it earns colour where the rest of the list does not.
 *
 * **It contains no business rule.** The thresholds here decide a colour and nothing else; what
 * actually fires a notification is `reminders.lead_days`, server-side (CLAUDE.md invariant 5). If
 * these numbers and the reminder lead times disagree, the badge is cosmetically off and the
 * reminders are still right.
 */

/** Whole days from today to `date`, negative when past. Both are calendar dates, so no timezone. */
export function daysUntil(date: string, today = new Date()): number {
  const target = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  )
  const midnightToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((target - midnightToday) / 86_400_000)
}

export function ExpiryBadge({ expiresOn }: { expiresOn: string | null }) {
  // Q1's answer, rendered: a document with no expiry is a normal, silent case — not a warning and
  // not an empty slot that looks like missing data.
  if (expiresOn === null) {
    return <span className="text-xs text-muted-foreground">No expiry</span>
  }

  const days = daysUntil(expiresOn)

  const { label, tone } =
    days < 0
      ? { label: `Expired ${Math.abs(days)}d ago`, tone: 'expired' as const }
      : days === 0
        ? { label: 'Expires today', tone: 'expired' as const }
        : days <= 30
          ? { label: `${days}d left`, tone: 'soon' as const }
          : days <= 90
            ? { label: `${days}d left`, tone: 'approaching' as const }
            : { label: expiresOn, tone: 'calm' as const }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tone === 'expired' && 'bg-destructive text-destructive-foreground',
        tone === 'soon' && 'bg-amber-500 text-white',
        tone === 'approaching' &&
          'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
        tone === 'calm' && 'bg-secondary text-secondary-foreground',
      )}
      // The exact date is always available on hover, since the badge shows a countdown up close.
      title={`Expires ${expiresOn}`}
    >
      {label}
    </span>
  )
}
