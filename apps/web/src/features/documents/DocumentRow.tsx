import type { Document } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { maskedNumber } from '@/lib/mask'
import { useFeel } from '@/lib/useFeel'
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
   * How wide the leading glyph column is.
   *
   * `narrow` (14px) is the default and the right thing on a list of documents alone: the column exists
   * only to stop titles shifting as the glyph changes shape between states, so it is sized to the
   * widest glyph and no wider.
   *
   * `wide` is **52px — the width of `ThingRow`'s thumbnail** — and exists for the merged library
   * (ADR-0032), where document and thing rows alternate. Without it the two kinds indent their titles
   * differently and the list reads as two lists that got shuffled together rather than one ledger.
   * The glyph stays 14px and centres in the wider column; nothing about it grows.
   */
  glyphColumn?: 'narrow' | 'wide'
  /**
   * Whether to draw the holder pill beside the title.
   *
   * `false` on a **person's own page**, where every row is that person's and the name is already the
   * heading — three identical pills reading "Priya" under a heading reading "Priya" is noise, and the
   * comp's person view draws none. Everywhere else it stays on: the pill is what distinguishes two
   * otherwise identical documents in a mixed list.
   */
  showHolder?: boolean
  /**
   * The number line and its Copy control — ADR-0027, amended by ADR-0036. Absent means no number is
   * drawn at all, which is what the Now screen's cards want.
   *
   * ── `revealed` and `onToggleReveal` used to be here, and are deliberately gone ──
   *
   * They were props rather than state because the archive header carried a **page-wide** Show that
   * revealed every row at once, so the revealed set had to live above the rows. ADR-0036 deleted that
   * control — a device-wide preference on the You screen says the same thing once instead of on every
   * page — so the only reveal left is per row, and a row is the right place to keep it. What remains
   * passed in is `grouped`, for the same reason the expiry is: the parent already has the formatter,
   * and a hundred rows should not each re-derive it.
   */
  number?: {
    /** What the document itself calls its number, e.g. "Aadhaar number". */
    label: string
    /** The full value, already grouped for reading. */
    grouped: string
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
  glyphColumn = 'narrow',
  showHolder = true,
  number,
  className,
}: DocumentRowProps) {
  const expiry = precomputed ?? expiryOf(document.expires_on, today)
  const { feel } = useFeel()
  /** Per row, and only reachable while the mask is on — see the note on the `number` prop. */
  const [revealed, setRevealed] = useState(false)

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
  const masking = feel.numbers === 'hidden'
  const shown = !masking || revealed

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
        className="flex min-w-0 flex-1 items-center gap-3.5 py-row-pad active:bg-sunken"
      >
        {/* A fixed column so titles line up whichever glyph a row happens to carry — the gauge is
            14px wide and the dash is 2px tall, and without the column the text would shift per state.
            14px alone, or 52px to match a thing's thumbnail in the merged library. See `glyphColumn`. */}
        <span
          className={cn(
            'flex shrink-0 items-center justify-center',
            glyphColumn === 'wide' ? 'w-[52px]' : 'w-3.5',
          )}
        >
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
            {showHolder && document.holder != null && document.holder !== '' && (
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
            when shown, so twelve digits fit. `tracking-label` (0.09em) rather than `tracking-mask`
            (0.14em): the mask token is sized for the 19px value on the detail screen, and at 13px it
            spaced the bullets so far apart they stopped reading as one field.

            The mask is derived here from the full value (`maskedNumber`) rather than read from a
            server field — ADR-0036 dropped `identifier_last4`, which was a copy of the last four
            characters of a value sitting in the same response.

            ── `break-all`, NOT `truncate`, and this was found by rendering it ──

            The line truncated while the mask was the only thing on it, which was harmless: `•••• 8109`
            is nine characters and never reached the edge. Showing the value by default put real
            numbers there, and a 20-character policy number came out as `FAKE-POL-9988776655…` at
            390px — the D37 clipping bug again, on the one field ADR-0036 exists to make readable. A
            number you cannot finish reading is worse than a mask, because a mask at least says so.

            So it wraps. `min-h-row` is a minimum rather than a height for exactly this reason, and the
            title above it still truncates — the title is recognisable from its first few words and a
            number is not.

            ── The value stands alone: no "Aadhaar number" in front of it on a row ──

            ADR-0027 put the label here because the row showed `•••• 8109` and nothing else, and four
            characters need telling apart from the four characters on the row below. That stopped being
            true when ADR-0036 showed the value: **the title one line up already names the document**,
            so `Aadhaar / Aadhaar number 7294 8103 8109` says it twice — and the second copy takes the
            width off the line that just started needing it.

            `number.label` is still passed and still used, by the Copy and Show controls' accessible
            names and by the page's copy toast. Those are not chrome: "Copy" alone is ambiguous the
            moment two numbered rows are on screen, and a screen reader gets no title-then-value
            adjacency to infer from. **The detail card keeps its visible label** — there the number is
            the subject with no title beside it, which is the case ADR-0027's argument actually covers.
          */}
          {hasNumber && number !== undefined && document.identifier !== null && (
            <span
              className={cn(
                'mt-1 block break-all font-mono text-meta font-medium text-ink-2',
                shown ? 'tracking-number' : 'tracking-label',
              )}
            >
              {shown ? number.grouped : maskedNumber(document.identifier)}
            </span>
          )}
        </span>
      </Link>

      {/*
        Copy, and Show only while the mask is on — outside the link. Both are 44px (`--tap-min`) even
        though they draw a 13px glyph: design.md §6, everything tappable clears the floor, including
        icon-only controls, and two of them side by side on a row is exactly where a miss lands on
        the wrong one. With numbers shown — the default — there is one control here, not two, which
        is also what gives a long number the width it needs.
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
          {masking && (
            <button
              type="button"
              onClick={() => setRevealed((previous) => !previous)}
              aria-label={`${revealed ? 'Hide' : 'Show'} ${number.label} for ${document.title}`}
              className={cn(
                'flex min-h-tap min-w-11 items-center justify-center rounded-2 font-mono text-[0.6875rem] tracking-label uppercase active:bg-rule/40',
                revealed ? 'text-ink' : 'text-ink-3',
              )}
            >
              {revealed ? 'Hide' : 'Show'}
            </button>
          )}
        </span>
      )}

      {/*
        ── No scan: a marker when the row is busy, a JOB when it is not ──

        Handoff 5 turns the bare dashed glyph into an **Add scan** button on rows that have nothing
        else on their right-hand side, which is the difference between labelling an absence and
        offering to fix it. A row that already carries Copy and Show keeps the small glyph — three
        controls on one row at 390px is where a miss lands on the wrong one.

        **It is a `<Link>` to the document's Scans section, not a file picker.** Opening the OS picker
        would mean firing `input.click()` after a navigation, which browsers refuse without a user
        gesture on the same page — a control that silently does nothing on some devices is worse than
        one that takes you to where the job is. The anchor lands on the section with its own Add
        button already in reach.
      */}
      {document.file_count === 0 &&
        (hasNumber ? (
          <span
            aria-hidden="true"
            className="ml-1 h-[17px] w-[13px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-ink-3"
          />
        ) : (
          <Link
            to="/documents/$documentId"
            params={{ documentId: document.id }}
            hash="scans"
            aria-label={`Add a scan to ${document.title}`}
            className="ml-3.5 flex min-h-tap shrink-0 items-center gap-[7px] rounded-2 border border-dashed border-rule-2 px-[11px] hover:border-ink"
          >
            <span
              aria-hidden="true"
              className="h-3.5 w-[11px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-ink-3"
            />
            <span className="whitespace-nowrap text-meta font-medium text-ink-2">Add scan</span>
          </Link>
        ))}

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
