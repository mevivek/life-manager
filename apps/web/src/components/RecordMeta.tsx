import { formatDateShort } from '@/features/documents/ExpiryStatus'
import { cn } from '@/lib/utils'

/**
 * When a record was added, and when it last changed. The last line of a detail screen.
 *
 * Shared by `documents.$documentId.tsx` and `ThingDetail.tsx` rather than written twice, for the reason
 * `documentRowProps.ts` exists (design.md §8): the same fact rendered by two files drifts, and this one
 * is a *footer* — the half nobody re-reads after the first review, so the drift would be permanent.
 *
 * ── Why it is below the delete control ──
 *
 * Both screens are ordered by what a person came here to find out, loudest first, and this is the
 * quietest thing on either: it answers a question nobody opens the app to ask. Delete keeps its place as
 * the last *control*; provenance sits under it as a rule and a grey line, closer to a ledger's page foot
 * than to a section.
 *
 * ── Why there is no version, and no id ──
 *
 * `version` is on both contracts and is deliberately not drawn. It is an optimistic-concurrency counter
 * (ADR-0024), and "Version" already means *a scan* on the documents screen — `DocumentFiles` draws
 * "Version 1" on a file row. Two meanings for one word on one screen is worse than an absent number.
 * The id is in the URL, and design.md §13's rule applies to both: a label must be one the value can
 * carry, and neither of these has a user-facing question it answers.
 */
export function RecordMeta({
  createdAt,
  updatedAt,
  className,
}: {
  createdAt: string | null | undefined
  /** Omitted from the line when it matches `createdAt` — see below. */
  updatedAt: string | null | undefined
  className?: string
}) {
  const added = formatStamp(createdAt)
  /**
   * Nothing at all rather than "Added —".
   *
   * `created_at` is required by both response schemas, so absence here means a cache entry written by an
   * older build being rehydrated **without** re-running Zod (debt D46) — a fixed, self-healing state that
   * a stray dash would outlive. The rest of the screen is unaffected either way.
   */
  if (added === null) return null

  /**
   * "Updated" is drawn only when something actually was.
   *
   * A freshly captured record has `updated_at === created_at`, and a second line saying it was updated
   * on the day it was added reads as an edit the user did not make. The comparison is on the *rendered
   * day*, not the raw timestamps: an edit ninety seconds after capture is not a fact worth a line, and
   * `2026-01-01T09:00:00Z` vs `…T09:01:30Z` would otherwise print the same date twice.
   */
  const updated = formatStamp(updatedAt)

  return (
    <section className={cn('mt-6 border-t border-rule pt-3.5', className)}>
      <p className="text-meta text-ink-3">
        Added {added}
        {updated !== null && updated !== added && ` · Updated ${updated}`}
      </p>
    </section>
  )
}

/**
 * An instant → `12 Jan 2026`, read from **local** date parts.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  `iso.slice(0, 10)` is wrong here, and it is wrong in the opposite direction to the usual bug.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Every other date in this app is a bare `YYYY-MM-DD` calendar date carrying no zone, which is why
 * `formatDate` slices the string instead of constructing a `Date` (see its note in `ExpiryStatus.tsx`).
 * `created_at` and `updated_at` are not that: they are `isoDateTimeSchema` — real instants, with a `Z`.
 * Slicing one takes the **UTC** calendar day, so a document captured at 18:00 on 30 July at UTC-07:00
 * reads back "Added 31 Jul" — the app disagreeing with the user about the day they did something.
 *
 * So the instant is resolved to the reader's own calendar day first, and only then handed to the one
 * month table the app has. `formatDateShort` rather than a second formatter for the same reason.
 */
export function formatStamp(iso: string | null | undefined): string | null {
  if (iso == null || iso === '') return null
  const at = new Date(iso)
  // `new Date('nonsense')` is an Invalid Date rather than a throw, and it renders as "NaN NaN NaN".
  if (Number.isNaN(at.getTime())) return null
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return formatDateShort(`${at.getFullYear()}-${month}-${day}`)
}
