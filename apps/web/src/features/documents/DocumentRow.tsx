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
  /**
   * The number line and its Copy / Show controls — ADR-0027. Absent means no number is drawn at all.
   *
   * Passed in rather than owned here, because the archive's header toggle reveals **every** row at
   * once: the revealed set has to live above the rows. `grouped` is passed in for the same reason the
   * expiry is — the parent already has the formatter, and a hundred rows should not each re-derive it.
   */
  number?: {
    /** What the document itself calls its number, e.g. "Aadhaar number". */
    label: string
    revealed: boolean
    /** The full value, already grouped for reading. Only shown when `revealed`. */
    grouped: string
    onToggleReveal: () => void
    onCopy: () => void
  }
  className?: string
}

export function DocumentRow({
  document,
  today,
  expiry: precomputed,
  divided = false,
  chevron = false,
  number,
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

  const hasNumber = number !== undefined && document.identifier !== null

  return (
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  A container, with the link and the number controls as SIBLINGS — not nested.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * The comp draws the row as a `div` with an `onClick` and calls `stopPropagation()` on the buttons
     * inside it. This row is a real `<Link>`, and `<button>` inside `<a>` is invalid HTML: interactive
     * content cannot nest. Browsers cope unevenly, screen readers announce the inner control as part
     * of the link's name, and a keyboard user cannot reach it.
     *
     * So the link covers the text and the controls sit beside it. Three separately focusable things —
     * open, copy, reveal — which is what they are. The hover tint moves to the container so the whole
     * row still lights up as one object, and `group`/`group-hover` is not needed because the tint is
     * on the element being hovered.
     */
    <div
      className={cn(
        // Horizontal padding lives on the CONTAINER, not on the link — the archive overrides it with
        // `-mx-gutter px-gutter` to run the rule full-bleed, and padding on both would double up.
        'flex min-h-row items-center px-4 transition-colors hover:bg-sunken',
        divided && 'border-t border-rule',
        className,
      )}
    >
      <Link
        to="/documents/$documentId"
        params={{ documentId: document.id }}
        aria-label={expiryAccessibleName(document.title, document.expires_on, today)}
        className="flex min-w-0 flex-1 items-center gap-3.5 py-3.5 active:bg-sunken"
      >
        {/* A fixed 14px column so titles line up whichever glyph a row happens to carry — the gauge is
            14px wide and the dash is 2px tall, and without the column the text would shift per state. */}
        <span className="flex w-3.5 shrink-0 items-center justify-center">
          <ExpiryGlyph state={expiry.state} />
        </span>

        <span className="min-w-0 flex-1">
          {/*
            The holder's name as a hairline pill beside the title — the design's badge.

            `shrink-0` on the pill and `min-w-0` on the title, so a long title truncates and the NAME
            never does: "Aadhaar" filed for Priya truncating to "Priy…" would be worse than a shortened
            title, because the name is the thing that distinguishes two otherwise identical documents.

            Absent for the owner's own documents. "Me" on nine rows out of ten is noise, and absence is
            how this system draws a default (`other`, no expiry, no scan).
          */}
          <span className="flex items-baseline gap-[7px]">
            <span className="min-w-0 truncate text-row font-medium leading-snug">
              {document.title}
            </span>
            {document.holder != null && document.holder !== '' && (
              <span className="shrink-0 rounded-pill border border-rule-2 px-[7px] text-[0.6875rem] font-medium text-ink-2">
                {document.holder}
              </span>
            )}
          </span>
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

          {/*
            The number — a third line, ADR-0027. Its own line rather than squeezed onto the meta row,
            because a 16-character policy number plus a status plus an issuer does not fit 390px, and
            the alternative is the "Version 1" clipping bug (D37) with a value the user needs to read
            digit by digit.

            Tracking is wider while masked, so `•••• 8109` reads as a deliberate format, and tighter
            when revealed, so twelve digits fit. `tracking-label` (0.09em) rather than `tracking-mask`
            (0.14em): the mask token is sized for the 19px value on the detail screen, and at 13px it
            spaced the bullets so far apart they stopped reading as one field.
          */}
          {hasNumber && number !== undefined && (
            <span className="mt-1 flex items-baseline gap-[7px]">
              <span className="shrink-0 text-[0.6875rem] text-ink-3">{number.label}</span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate font-mono text-meta font-medium text-ink-2',
                  number.revealed ? 'tracking-number' : 'tracking-label',
                )}
              >
                {number.revealed ? number.grouped : `•••• ${document.identifier_last4 ?? ''}`}
              </span>
            </span>
          )}
        </span>
      </Link>

      {/*
        Copy and Reveal, outside the link. Both are 44px (`--tap-min`) even though they draw a 13px
        glyph — design.md §6: everything tappable clears the floor, including icon-only controls, and
        two of them side by side on a row is exactly where a miss lands on the wrong one.
      */}
      {hasNumber && number !== undefined && (
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={number.onCopy}
            aria-label={`Copy ${number.label} for ${document.title}`}
            className="flex min-h-tap min-w-11 items-center justify-center rounded-2 text-ink-3 active:bg-rule/40 hover:text-ink-2"
          >
            {/* Two offset rectangles — the universal copy glyph, drawn rather than imported, for the
                same reason the tab glyphs are: geometry, not illustration. */}
            <span aria-hidden="true" className="relative block h-3.5 w-[13px]">
              <span className="absolute top-0 left-0 h-[11px] w-[9px] rounded-[2px] border-[1.5px] border-current" />
              <span className="absolute right-0 bottom-0 h-[11px] w-[9px] rounded-[2px] border-[1.5px] border-current bg-raised" />
            </span>
          </button>
          <button
            type="button"
            onClick={number.onToggleReveal}
            aria-label={`${number.revealed ? 'Hide' : 'Show'} ${number.label} for ${document.title}`}
            className={cn(
              'flex min-h-tap min-w-11 items-center justify-center rounded-2 font-mono text-[0.6875rem] tracking-label uppercase active:bg-rule/40',
              number.revealed ? 'text-ink' : 'text-ink-3',
            )}
          >
            {number.revealed ? 'Hide' : 'Show'}
          </button>
        </span>
      )}

      {/*
        The no-scan marker: a dashed page outline. Dashed rather than a filled icon because it marks
        an *absence*, and it is the same glyph the Now screen's nudge row uses so the two read as one
        idea. `aria-hidden` — the row's accessible name does not mention it, because "no scan" is a
        job rather than a status, and the nudge row is where that job is named.
      */}
      {document.file_count === 0 && (
        <span
          aria-hidden="true"
          className={cn(
            'h-[17px] w-[13px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-ink-3',
            // With the controls present the marker sits inside their gap rather than widening the row.
            hasNumber ? 'ml-1' : 'ml-3.5',
          )}
        />
      )}

      {/* Only on rows inside a card, where the row's edges give no other affordance. */}
      {chevron && (
        <span
          aria-hidden="true"
          className="ml-3.5 h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
        />
      )}
    </div>
  )
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
