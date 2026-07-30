import { Link } from '@tanstack/react-router'
import { Eyebrow } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { HorizonEntry, HorizonTone } from './useLedger'

/**
 * The forward timeline. ADR-0025 §1 — and the single change that makes the Now screen work.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why "all clear" is not enough, and this exists
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The hardest state on this screen is the *good* one. A dashboard that says only "nothing needs you"
 * is worthless to someone who opens the app twice a month: it answers a question they did not ask
 * ("is anything on fire?") and withholds the one they did ("when is the next thing?").
 *
 * So Now **always** shows the forward timeline — the next date however far away — which means the
 * answer is never *nothing*, it is "nothing until 4 March".
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  It is CROSS-DOMAIN now, and SHAPE is what separates the domains on it
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0029 and design.md §8. A thing's warranty end and its next service sit on this same list, sorted
 * by date among the expiries, and the only things that distinguish them are a **square** dot instead of
 * a round one and a **mono kicker** ("Warranty ends", "Service due"). No section header, no divider, no
 * separate list.
 *
 * That restraint is the feature. Two headers would have been easier and would have destroyed the one
 * property Now has — that it answers *"what is next"* without asking which domain it is in. If you are
 * about to add a grouping here, read ADR-0025 §4 first.
 *
 * The merge itself is `buildHorizon` in `useLedger.ts`; this file only draws. In particular it holds no
 * date arithmetic and no exclusion rule — `gone` things and anything already past are filtered there,
 * where they can be tested without a DOM.
 *
 * ── Two empty states, and only one of them is furniture ──
 *
 * See the branch below. A previous session collapsed them into one `if (rows.length === 0) return null`
 * and shipped a blank half-screen, reported from a real phone.
 *
 * ── Four entries, five at 430px ──
 *
 * From ADR-0025 §8. The count is here rather than in CSS because it is a data decision — slicing in
 * JS is honest about showing fewer rows, whereas hiding the fifth with `display: none` would still
 * put it in the accessibility tree and in the "N more further out" arithmetic below.
 *
 * It reads the breakpoint with `matchMedia` at render rather than a resize listener: a phone does not
 * change width mid-session, and a listener for a value that never changes is a subscription to
 * nothing.
 */

const NARROW_COUNT = 4
const WIDE_COUNT = 5

function horizonCount(): number {
  if (typeof matchMedia !== 'function') return NARROW_COUNT
  return matchMedia('(min-width: 430px)').matches ? WIDE_COUNT : NARROW_COUNT
}

/**
 * The tone of an entry's date line, as classes.
 *
 * Mapped here rather than carried on the entry, so the only Tailwind in the Now screen's data path is
 * none at all (design.md §1). `quiet` is `--ink-2` and not a status hue on purpose — a service booked
 * for next spring is a fact, not an all-clear.
 */
const TONE: Record<HorizonTone, string> = {
  ok: 'text-status-ok',
  soon: 'text-status-soon',
  quiet: 'text-ink-2',
}

export function Horizon({
  entries,
  /**
   * How many **documents** carry a date we watch, including the urgent ones above.
   *
   * It feeds the empty branch and nothing else — the "N more further out" arithmetic below is computed
   * from `entries`, because with two domains on the timeline a documents-only total would report a
   * wrong number under a list it does not describe. See the footer's own note.
   */
  datedDocuments,
  /**
   * False when any date might be missing — the archive spilled a page, **or** a whole domain could not
   * be read. Both make "that's every date we hold" a claim we cannot support, and the caller is the
   * only thing that knows either.
   */
  complete,
}: {
  entries: HorizonEntry[]
  datedDocuments: number
  complete: boolean
}) {
  /**
   * Empty, but for two different reasons — and only one of them is furniture.
   *
   * `datedDocuments === 0` with nothing on the timeline means nothing anywhere is coming: no document
   * carries a date, and no thing has a warranty or service ahead of it either (a single forward thing
   * event would have put an entry in `entries` and skipped this branch entirely). The headline already
   * says the documents half — "No document here has an expiry date" — so a timeline saying it again is
   * decoration: render nothing.
   *
   * `datedDocuments > 0` with no entries means every dated document is *already* in Needs you — so the
   * horizon is empty because everything is urgent, not because nothing is tracked. That is a real
   * fact about the archive and the screen should state it, or a person reading a 6-day passport
   * warning is left wondering what comes after it. Reported from a real phone: two documents, one
   * dated, and the lower half of the screen was blank because this branch returned `null`.
   *
   * **What the second domain changed here, and what it did not.** The condition is still a document
   * count, and that is not laziness: reaching this branch already proves there is no forward thing
   * event, so the only question left is whether the *documents* half was worth restating. What it does
   * mean is that the sentence is now MORE true than it was — "nothing else has a date we watch" covers
   * both domains, because both were merged before this test ran.
   *
   * Deliberately not the timeline treatment — no rule, no dots. A line of prose, because there is no
   * sequence to draw.
   */
  if (entries.length === 0) {
    if (datedDocuments === 0) return null
    return (
      <section className="pt-1.5">
        <div className="pb-2.5">
          <Eyebrow>The horizon</Eyebrow>
        </div>
        <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          {/*
            "Nothing else" is the load-bearing word, and it is true in every shape of this state: the
            dated documents all sit in Needs you above, and no thing has a date ahead of it. Note it
            cannot use `beyond` below — that arithmetic would report the urgent ones as "further out",
            which is the opposite of where they are.
          */}
          Nothing else has a date we watch
          {complete ? '.' : ' in what we could load.'}
        </p>
      </section>
    )
  }

  const shown = entries.slice(0, horizonCount())
  /**
   * What is on the timeline but did not fit — and **only** that.
   *
   * This used to be `datedTotal - shown.length`, which folded the urgent documents shown *above* into a
   * sentence that calls them "further out", and which now under-counts as well: `shown` holds thing
   * events that a documents-only total never counted. Both are the same mistake — arithmetic taken over
   * a different population from the one the words describe. Counting the list against itself cannot
   * drift, whatever else joins it.
   */
  const beyond = entries.length - shown.length

  return (
    <section className="pt-1.5">
      <div className="flex items-baseline justify-between pb-2.5">
        <Eyebrow>The horizon</Eyebrow>
        <span className="text-meta text-ink-3">next {shown.length}</span>
      </div>

      <div className="relative pl-5">
        {/*
          The rule the dots sit on. Inset 6px from the top and 16px from the bottom so it starts and
          ends *inside* the first and last dot rather than poking out past them — a line that
          overshoots reads as a line that was cut off.
        */}
        <div aria-hidden="true" className="absolute top-1.5 bottom-4 left-1 w-px bg-rule-2" />

        <ol className="list-none">
          {shown.map((entry) => (
            <li key={entry.key} className="relative">
              <EntryLink entry={entry}>
                {/*
                  ═══════════════════════════════════════════════════════════════════════
                   The dot: ROUND for a document, SQUARE for a thing. This is the whole
                   cross-domain distinction, and it must survive greyscale.
                  ═══════════════════════════════════════════════════════════════════════

                  Both are hollow the same way — a `--paper` fill with a 2px tone ring, so the timeline
                  rule appears to pass behind the dot rather than through it. Only the corner radius
                  differs, exactly as `ExpiryGlyph`'s square/ring/gauge differ: shape first, colour
                  fourth (design.md §2).

                  `rounded-full` versus nothing rather than a `--radius-*` token, because a 9px box is
                  below the radius scale — the smallest step (`--r-1`, 3px) would visibly round the
                  square and blunt the one difference this dot exists to carry.
                */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute top-[5px] -left-5 box-border block size-[9px] border-2 border-current bg-paper',
                    entry.kicker === null && 'rounded-full',
                    TONE[entry.tone],
                  )}
                />
                {/*
                  The kicker — a thing event only. Mono, uppercase, tracked: the same register the
                  expiry ladder uses for a stamp, because this too is the machine naming what a date
                  IS rather than a person describing it (design.md §3).
                */}
                {entry.kicker !== null && (
                  <span className="block pb-1 font-mono text-label font-medium uppercase tracking-label text-ink-3">
                    {entry.kicker}
                  </span>
                )}
                {/*
                  The date FIRST, then the distance — "12 Sep 2026 · in 8 months". The reverse
                  ordering is what the rows use, because in a row the distance is the urgent part. On
                  the horizon nothing is urgent by definition, so the date is the useful anchor and
                  the distance is the gloss.

                  A uniform sans 500 rather than either ladder's per-state type: every entry here is
                  far enough away to be quiet by construction, so varying the weight would be varying
                  nothing. The tone still moves, because a warranty ending in six weeks and one ending
                  in three years are not the same news.
                */}
                <span className={cn('block text-meta font-medium', TONE[entry.tone])}>
                  {entry.when}
                </span>
                <span className="mt-0.5 block font-heading text-serif-row font-face-h leading-snug">
                  {entry.title}
                </span>
                {entry.meta !== '' && (
                  <span className="mt-px block text-meta text-ink-3">{entry.meta}</span>
                )}
              </EntryLink>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        {beyond > 0
          ? // "dates", not "documents": the list holds two kinds of thing now, and naming one of them
            // would be wrong about the other. `beyond` counts entries, so this is exact.
            `${beyond} more date${beyond === 1 ? '' : 's'} further out.`
          : complete
            ? 'That’s every date we hold.'
            : // Without every page and every domain loaded, "that's every date we hold" is a claim we
              // cannot make — and "more than fits on one page" would be a *different* false claim once
              // the reason can be an unreachable domain rather than pagination. Say only what is true.
              'There may be more further out.'}
      </p>
    </section>
  )
}

/**
 * The row's link, discriminated on which domain the entry came from.
 *
 * Two branches rather than a computed `to`, because TanStack Router types `params` against the path —
 * a single `<Link to={entry.to}>` would need the params widened to a union the router cannot narrow,
 * which is a cast, which is the thing that lets a wrong param ship.
 */
function EntryLink({ entry, children }: { entry: HorizonEntry; children: React.ReactNode }) {
  // Every entry is one tappable block: 56px minimum so it clears the 44px floor with the kicker's
  // extra line, and `pb-5` is the gap between dots on the rule rather than a margin, so the hit area
  // runs all the way to the next entry.
  const className = 'block min-h-14 pb-5'

  if (entry.entity === 'thing') {
    return (
      <Link
        to="/things/$thingId"
        params={{ thingId: entry.thingId }}
        aria-label={entry.accessibleName}
        className={className}
      >
        {children}
      </Link>
    )
  }

  return (
    <Link
      to="/documents/$documentId"
      params={{ documentId: entry.documentId }}
      aria-label={entry.accessibleName}
      className={className}
    >
      {children}
    </Link>
  )
}
