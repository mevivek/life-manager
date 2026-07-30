import type { Document } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import {
  type Expiry,
  ExpiryGlyph,
  ExpiryWords,
  expiryAccessibleName,
  expiryOf,
} from './ExpiryStatus'

/**
 * One document, as a row. ADR-0025 §7 — the component the whole archive is made of.
 *
 * Geometry: a 14px glyph column · the title in sans 500/16 · status and meta **baseline-aligned**
 * beneath it · an optional dashed page glyph when there is no scan. `min-h-row` is 72px, and it is a
 * *minimum* rather than a height so that at 200% system text the row grows instead of clipping.
 *
 * ── The accessible name carries the status in words ──
 *
 * The glyph is `aria-hidden` (it is a drawing of a fact, not the fact) and the row's `aria-label`
 * spells the whole thing out: *"Passport — expires in 6 weeks, 12 September 2026"*. Without that, a
 * screen reader gets the title and a relative phrase with no date, because the exact date is only in
 * a `title` tooltip that touch and speech both ignore.
 *
 * ── Rows are tabbable, not merely tappable ──
 *
 * They are real `<Link>`s, so keyboard focus and the global `:focus-visible` ring come for free. The
 * previous implementation was also a Link; the thing that changes here is that the *status* is now
 * inside the accessible name rather than a sibling badge.
 */

export type DocumentRowProps = {
  document: Document
  /** Overrides "now" — for tests, and for a screen that has already computed it. */
  today?: Date
  /** Precomputed by `toLedger`, so a list of 100 rows does not re-derive each one. */
  expiry?: Expiry
  /**
   * A hairline above. Only the 2nd row onward inside a bordered card needs one — the card's own
   * border is the first row's top edge.
   */
  divided?: boolean
  /**
   * The trailing chevron.
   *
   * **Separate from `divided`, and it used to be the same flag.** Tying the chevron to `divided` meant
   * the FIRST row in a grouped card had no chevron while every row beneath it did — visible
   * immediately in a 390px screenshot and invisible to every test, because a decorative
   * `aria-hidden` span has nothing to assert on. The two properties are genuinely different: the rule
   * depends on position, the chevron on context.
   */
  chevron?: boolean
  className?: string
}

export function DocumentRow({
  document,
  today,
  expiry: precomputed,
  divided = false,
  chevron = false,
  className,
}: DocumentRowProps) {
  const expiry = precomputed ?? expiryOf(document.expires_on, today)

  /**
   * `Financial · Aviva`, or `Title only`.
   *
   * "Title only" rather than an empty line: Q2 makes a document with nothing but a name a completely
   * normal thing to own, and a blank meta row reads as data that failed to load. `doc_type` is
   * omitted when it is `other`, because "Other" as a label says less than nothing — it is the schema
   * default, so it appears on every document the user never typed a type for.
   */
  const meta =
    [document.doc_type === 'other' ? null : capitalise(document.doc_type), document.issuer]
      .filter((part) => part !== null && part !== '')
      .join(' · ') || 'Title only'

  return (
    <Link
      to="/documents/$documentId"
      params={{ documentId: document.id }}
      aria-label={expiryAccessibleName(document.title, document.expires_on, today)}
      className={cn(
        'flex min-h-row items-center gap-3.5 px-4 py-3.5 transition-colors active:bg-sunken hover:bg-sunken',
        divided && 'border-t border-rule',
        className,
      )}
    >
      {/* A fixed 14px column so titles line up whichever glyph a row happens to carry — the gauge is
          14px wide and the dash is 2px tall, and without the column the text would shift per state. */}
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        <ExpiryGlyph state={expiry.state} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-row font-medium leading-snug">{document.title}</span>
        {/*
          The status must never shrink; the meta must always be the thing that truncates.
          `whitespace-nowrap` alone does not achieve that — a flex item still shrinks below its
          content, so a long issuer squeezed "EXPIRED 7 WEEKS AGO" until it overflowed its own box
          rather than shortening "Regional Transport Office" beside it. The status is the fact; the
          issuer is the gloss, so `shrink-0` on one and `min-w-0 flex-1` on the other.
        */}
        <span className="mt-0.5 flex items-baseline gap-[7px]">
          <ExpiryWords expiry={expiry} className="shrink-0 whitespace-nowrap" />
          <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{meta}</span>
        </span>
      </span>

      {/*
        The no-scan marker: a dashed page outline. Dashed rather than a filled icon because it marks
        an *absence*, and it is the same glyph the Now screen's nudge row uses so the two read as one
        idea. `aria-hidden` — the row's accessible name does not mention it, because "no scan" is a
        job rather than a status, and the nudge row is where that job is named.
      */}
      {document.file_count === 0 && (
        <span
          aria-hidden="true"
          className="h-[17px] w-[13px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-ink-3"
        />
      )}

      {/* Only on rows inside a card, where the row's edges give no other affordance. */}
      {chevron && (
        <span
          aria-hidden="true"
          className="h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
        />
      )}
    </Link>
  )
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
