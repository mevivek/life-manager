import { Link } from '@tanstack/react-router'
import { Eyebrow } from '@/components/ui/label'
import { expiryAccessibleName, formatDateShort } from './ExpiryStatus'
import type { LedgerRow } from './useLedger'

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
 * So Now **always** shows the forward timeline — the next expiry however far away — which means the
 * answer is never *nothing*, it is "nothing until 4 March". That is why this component has no empty
 * variant worth speaking of: if there are no dated documents at all it renders nothing and the
 * headline carries the message instead, because a timeline with no entries is furniture.
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

export function Horizon({
  rows,
  /** Dated documents beyond the horizon's slice AND inside "Needs you" — for the footer's count. */
  datedTotal,
  /** False when the archive did not fit in one page, so the footer must not claim a total. */
  complete,
}: {
  rows: LedgerRow[]
  datedTotal: number
  complete: boolean
}) {
  if (rows.length === 0) return null

  const shown = rows.slice(0, horizonCount())
  const beyond = datedTotal - shown.length

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
          {shown.map(({ document, expiry }) => (
            <li key={document.id} className="relative">
              <Link
                to="/documents/$documentId"
                params={{ documentId: document.id }}
                aria-label={expiryAccessibleName(document.title, document.expires_on)}
                className="block min-h-14 pb-5"
              >
                {/*
                  A hollow dot: `--paper` fill with a 2px tone ring, so the timeline rule appears to
                  pass behind it rather than through it.
                */}
                <span
                  aria-hidden="true"
                  className="absolute top-[5px] -left-5 box-border block size-[9px] rounded-full border-2 border-current bg-paper text-status-ok"
                />
                {/*
                  The date FIRST, then the distance — "12 Sep 2026 · in 8 months". The reverse
                  ordering is what the rows use, because in a row the distance is the urgent part. On
                  the horizon nothing is urgent by definition, so the date is the useful anchor and
                  the distance is the gloss.

                  A uniform sans 500 rather than the ladder's per-state type: every entry here is
                  `far` by construction, so varying the weight would be varying nothing.
                */}
                <span className="block text-meta font-medium text-status-ok">
                  {document.expires_on !== null && formatDateShort(document.expires_on)} ·{' '}
                  {expiry.label}
                </span>
                <span className="mt-0.5 block font-serif text-serif-row leading-snug">
                  {document.title}
                </span>
                <span className="mt-px block text-meta text-ink-3">
                  {[
                    document.doc_type === 'other' ? null : capitalise(document.doc_type),
                    document.issuer,
                  ]
                    .filter((part) => part !== null && part !== '')
                    .join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </div>

      <p className="text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        {beyond > 0
          ? `${beyond} more dated document${beyond === 1 ? '' : 's'} further out.`
          : complete
            ? 'That’s every date we hold.'
            : // Without the whole archive loaded, "that's every date we hold" would be a claim we
              // cannot make. Say what is true instead.
              'More further out than fits on one page.'}
      </p>
    </section>
  )
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
