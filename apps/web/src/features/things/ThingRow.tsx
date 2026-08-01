import { KIND_LABELS, type Thing } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { formatDateShort } from '@/features/documents/ExpiryStatus'
import { cn } from '@/lib/utils'
import { CoverStatus, coverAccessibleName, ServiceLine, serviceOf } from './CoverStatus'

/**
 * One thing, as a row. things.md §7, and the sibling of `features/documents/DocumentRow.tsx`.
 *
 * Geometry, from the comp: a 52×40 thumbnail · the name in sans 500/16 with an optional holder pill ·
 * the **cover** line (bar, tag, words) · a meta line of kind · brand and a document count · and a
 * fourth line only when the thing is not here. `min-h-row` is a *minimum* rather than a height, so at
 * 200% system text the row grows instead of clipping.
 *
 * ── Why this is a whole second row component and not a prop on `DocumentRow` ──
 *
 * The two rows share a shape and almost nothing else. A document's row leads with a 14px expiry glyph
 * and can carry a masked number with Copy and Show; a thing's leads with a photo and carries a
 * proportional cover bar, a document count and an ownership state. Parameterising one component over
 * both would mean five booleans and a status ladder chosen by a flag — which is exactly the coupling
 * ADR-0029 rejected when it refused to make a thing a `doc_type`.
 *
 * ── The accessible name carries the cover state in words ──
 *
 * Every glyph here is `aria-hidden` — the bar, the thumbnail, the chevron — so `coverAccessibleName`
 * is where the state exists for a screen reader: *"Volkswagen Golf — cover ended, 20 January 2026"*.
 * design.md §9: both the relative distance **and** the absolute date, because there is no tooltip and
 * no second glance at a 34px bar.
 *
 * ── Rows are tabbable, not merely tappable ──
 *
 * A real `<Link>`, so keyboard focus and the global `:focus-visible` ring come for free.
 */

export type ThingRowProps = {
  thing: Thing
  /** Overrides "now" — for tests, and for a screen that has already computed it. */
  today?: Date
  /** A hairline above. Only the 2nd row onward inside a bordered card needs one. */
  divided?: boolean
  className?: string
}

export function ThingRow({ thing, today, divided = false, className }: ThingRowProps) {
  /**
   * `Vehicle · Volkswagen`.
   *
   * `KIND_LABELS.other` is "Thing", which says nothing on a row — it is the schema default, so it
   * would appear on every thing whose kind was never chosen. Omitted, exactly as `DocumentRow` omits
   * `doc_type: 'other'`. Unlike a document there is no "Title only" fallback needed: a thing always
   * has *some* meta, because if both the kind and the brand are absent the line simply is not drawn.
   */
  const meta = [thing.kind === 'other' ? null : KIND_LABELS[thing.kind], thing.brand]
    .filter((part) => part !== null && part !== '')
    .join(' · ')

  const away = awayOf(thing)

  return (
    /**
     * The whole row is the link — no sibling controls.
     *
     * `DocumentRow` needs a container with the link and its Copy/Show buttons as *siblings*, because
     * `<button>` inside `<a>` is invalid HTML. A thing's row has no inner controls at all (the
     * thumbnail is **not** a drop target — things.md §7), so there is nothing to keep outside it and
     * the simpler structure is the honest one.
     *
     * Horizontal padding lives on the outer element so a list can override it with
     * `-mx-gutter px-gutter` to run its rule full-bleed.
     */
    <Link
      to="/things/$thingId"
      params={{ thingId: thing.id }}
      aria-label={coverAccessibleName(thing.name, thing, today)}
      className={cn(
        'flex min-h-row items-center gap-3.5 px-4 py-row-pad transition-colors hover:bg-sunken active:bg-sunken',
        divided && 'border-t border-rule',
        /**
         * `gone` is **dimmed, not hidden** — things.md §4 rule 4. Hiding a sold thing would make the
         * archive lie about what it holds, and the record is kept precisely because proving what you
         * handed over and when is a large part of why anyone files a receipt. 55% is the comp's value.
         */
        thing.ownership === 'gone' && 'opacity-55',
        className,
      )}
    >
      <ThingThumbnail />

      <span className="min-w-0 flex-1">
        {/*
          The holder's name as a hairline pill beside the name — the design's badge.

          `shrink-0` on the pill and `min-w-0 truncate` on the name, so a long name truncates and the
          PERSON never does: "Bicycle" filed for Priya truncating to "Priy…" would be worse than a
          shortened name, because the person is what distinguishes two otherwise identical things.

          Absent when `holder` is null. A "Me" pill on nine rows out of ten is noise, and absence is
          how this system draws a default (things.md §4 rule 6).
        */}
        <span className="flex items-baseline gap-[7px]">
          <span className="min-w-0 truncate text-row font-medium leading-snug">{thing.name}</span>
          {thing.holder != null && thing.holder !== '' && (
            <span className="shrink-0 rounded-pill border border-rule-2 px-[7px] text-label font-medium text-ink-2">
              {thing.holder}
            </span>
          )}
        </span>

        {/* The cover ladder. Never hand-rolled here — design.md §2a, and there are exactly two. */}
        <CoverStatus thing={thing} today={today} className="mt-1 max-w-full" />

        {/*
          Meta and the document count. The count is the reason the domain exists — "where are its
          papers" — so it sits on the row rather than only on the detail screen, and it is `shrink-0`
          while the meta truncates: "3 documents" squeezed to "3 docum…" beside a fully drawn brand
          name would be the wrong thing surviving.

          The count is `text-meta` (13px) where the comp draws 12px. There is no 12px token and
          design.md §1 forbids inventing one at a call site — the half-step is not worth a token, and a
          count is not a size the design depends on to the pixel.
        */}
        {(meta !== '' || thing.document_count > 0) && (
          <span className="mt-[3px] flex items-baseline gap-2">
            {meta !== '' && <span className="min-w-0 truncate text-meta text-ink-3">{meta}</span>}
            {thing.document_count > 0 && (
              <span className="shrink-0 text-meta text-ink-3">
                {thing.document_count === 1 ? '1 document' : `${thing.document_count} documents`}
              </span>
            )}
          </span>
        )}

        {/*
          ── The plate, drawn as a plate ──

          A vehicle's registration is the one serial that is **public by design**: it is painted on
          the outside of the object, so masking it on a row protects nothing and hides the value an
          owner actually reads aloud. Handoff 5 draws it here, and `ThingSerial` stops masking it on
          the detail screen for the same reason. Every other kind's serial stays off the row entirely
          — an IMEI is inside the phone, and a list is the worst place to leak one.

          Styled as a physical plate rather than as text: a hairline `--ink-2` border, 4px radius,
          mono with wide tracking. That is what makes it scannable in a list without a label beside
          it — nothing else in this app looks like this, so it reads as "a number plate" rather than
          as another meta field.
        */}
        {thing.kind === 'vehicle' && thing.serial != null && thing.serial !== '' && (
          <span className="mt-[5px] inline-flex h-6 w-fit items-center rounded-1 border border-ink-2 bg-raised px-2 font-mono text-meta font-medium tracking-[0.07em] text-ink">
            {thing.serial}
          </span>
        )}

        {/*
          The fourth line, only when the thing is not here — things.md §4 rule 4.

          `lent` is `--status-soon` because it is an *open loop* you may want to close; `gone` is
          `--ink-3` because it is settled, and the row is already dimmed. Neither is a warning: a state
          is not a problem.
        */}
        {away !== null && (
          <span className="mt-1 flex items-baseline gap-[7px]">
            <span
              className={cn(
                'shrink-0 font-mono text-label font-medium uppercase tracking-label',
                away.tone,
              )}
            >
              {away.tag}
            </span>
            <span className="min-w-0 truncate text-meta text-ink-2">{away.label}</span>
          </span>
        )}

        {/*
          The service line, and only when it is actually an errand.

          `ServiceLine` renders nothing without a `service_due_on`; this additionally suppresses the
          `scheduled` state, so a service booked for next spring does not add a line to every row of a
          six-thing list. Overdue and due-within-45-days are jobs; a date eight months out is not.
        */}
        {isServiceUrgent(thing, today) && (
          <ServiceLine thing={thing} today={today} className="mt-1" />
        )}
      </span>

      {/* The trailing chevron: two borders on a rotated square, as the comp draws it. */}
      <span
        aria-hidden="true"
        className="h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
      />
    </Link>
  )
}

/**
 * The 52×40 thumbnail.
 *
 * **Always the placeholder, for now.** A thing's hero photo needs a presigned download URL per photo
 * (things.md §5), which is a request per row and a URL that expires — so the list draws the comp's
 * little two-rectangle glyph and the detail screen is where a photo is seen. The comp says the same
 * thing from the other end: *"the list thumbnail is NOT a drop target"*, because a 52×40 box cannot
 * carry drop chrome.
 *
 * The box is drawn even when empty rather than collapsed: without it the name's left edge would shift
 * between rows depending on whether a thing has a photo, which is the same alignment argument
 * `DocumentRow`'s fixed glyph column makes.
 *
 * Arbitrary sizes here ARE the content (design.md §1): 52×40 is the comp's geometry for a glyph box,
 * and the inner rectangles are 5×8 and 7×12 — sizes a `--spacing-*` token would round out of shape.
 */
function ThingThumbnail() {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-[52px] shrink-0 items-center justify-center overflow-hidden rounded-[7px] border border-rule-2 bg-sunken"
    >
      <span className="flex items-end gap-[2px]">
        <span className="block h-2 w-[5px] rounded-[1px] border-[1.5px] border-ink-3" />
        <span className="block h-3 w-[7px] rounded-[1px] border-[1.5px] border-ink-3" />
      </span>
    </span>
  )
}

/** The tag, words and tone for a thing that is not here. `null` when `ownership` is `here`. */
function awayOf(thing: Thing): { tag: string; label: string; tone: string } | null {
  if (thing.ownership === 'here') return null

  const lent = thing.ownership === 'lent'
  const who = thing.ownership_who
  const since = thing.ownership_since

  /**
   * `ownership_who` and `ownership_since` are both optional even when the state is not `here`
   * (things.md §3), so every combination has to read as a sentence. "Lent out" alone is less
   * information than "Lent to Sam · 4 Mar 2026" and it is still true, which is the test — a row that
   * printed "Lent to null" would be the alternative.
   *
   * `formatDateShort`, not the raw column: the row used to print `2026-03-04` while the detail banner
   * printed `4 Mar 2026` for the same record. Nothing else in either domain shows a user an ISO date,
   * and the helper is `OwnershipPanel`'s `awayLabel`'s so the two sentences cannot drift again.
   */
  const parts = [
    who === null || who === ''
      ? lent
        ? 'Lent out'
        : 'Handed on'
      : `${lent ? 'Lent to' : 'Handed to'} ${who}`,
    since === null || since === '' ? null : formatDateShort(since),
  ].filter((part) => part !== null && part !== '')

  return {
    tag: lent ? 'With someone else' : 'No longer yours',
    label: parts.join(' · '),
    tone: lent ? 'text-status-soon' : 'text-ink-3',
  }
}

/**
 * Whether the service is an errand rather than a diary entry.
 *
 * The state comes from `serviceOf` rather than from a second comparison against `SERVICE_DUE_DAYS` —
 * a threshold read in two places is a threshold that can disagree with itself, which is the whole
 * reason both ladders keep their boundary next to the function that buckets on it.
 */
function isServiceUrgent(thing: Thing, today?: Date): boolean {
  const service = serviceOf(thing, today)
  return service !== null && service.state !== 'scheduled'
}
