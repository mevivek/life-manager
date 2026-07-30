import type { Thing } from '@life-manager/shared'
import { Card } from '@/components/ui/card'
import { daysUntil, formatDateShort } from '@/features/documents/ExpiryStatus'
import { cn } from '@/lib/utils'
import {
  COVER_BG,
  CoverBar,
  CoverTag,
  CoverWords,
  coverOf,
  ServiceLine,
  serviceOf,
} from './CoverStatus'

/**
 * The cover card — the top of the Thing detail screen, and the answer to *"is this still covered?"*
 * things.md §7, comp lines 718–736.
 *
 * It is the sibling of the status block on `documents.$documentId.tsx`, and the same reasoning puts it
 * first: the screen is ordered by what a person came here to find out. Tinted with the cover state's
 * own ground (`COVER_BG`), so the answer is legible before a word is read.
 *
 * Everything about the *ladder* — the states, the words, the shapes, the tones — belongs to
 * `CoverStatus.tsx` and is imported. This file is layout: what goes beside what, and in what order.
 * Do not re-derive a state here (design.md §2a).
 *
 * Four things sit in it, in this order, and each answers a different question:
 *
 *  1. **The tag and the span** — `COVERED` on the left, `12 Mar 2024 → 12 Mar 2027` on the right.
 *  2. **The bar** — proportional, full width, so the span is a picture rather than a subtraction.
 *  3. **The words and the age** — "3 years left" beside "2y 3m old".
 *  4. **The service tag**, under a hairline, because it is a *different* date on a *different*
 *     threshold (45 days, not 60) and putting it in the same row would imply one ladder.
 */
export function ThingCoverCard({
  thing,
  today,
  className,
}: {
  thing: Pick<Thing, 'purchased_on' | 'warranty_ends_on' | 'service_due_on'>
  /** Injectable so tests are arithmetic rather than a race with the clock. */
  today?: Date
  className?: string
}) {
  const cover = coverOf(thing, today)
  const service = serviceOf(thing, today)
  const age = ageOf(thing.purchased_on, today)
  const span = coverSpan(thing.purchased_on, thing.warranty_ends_on)

  return (
    <Card className={cn('p-card', COVER_BG[cover.state], className)}>
      <div className="flex items-baseline justify-between gap-2.5">
        <CoverTag cover={cover} />
        {span !== null && <span className="text-meta text-ink-3">{span}</span>}
      </div>

      {/*
        Full width, where `CoverBar` draws a 34px glyph by default.

        `min-w-full` rather than a bigger `width` prop, and rather than `w-full`: `CoverBar` sets
        `width` as an **inline style** (it is a glyph dimension and a datum, per its own note), and an
        inline `width` beats any class. `min-width` is the one property that wins over it without
        reaching for `!important` — the used width is the larger of the two, so 100% takes over and the
        inner fill's percentage is then a percentage of the full track.
      */}
      <CoverBar cover={cover} className="mt-2.5 min-w-full" />

      <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <CoverWords cover={cover} size="large" />
        {/*
          ═══════════════════════════════════════════════════════════════════════════════════════
           Age is the number that decides repair-or-replace.
          ═══════════════════════════════════════════════════════════════════════════════════════

          Nobody wants to do that subtraction standing next to a broken machine — which is exactly
          when it is needed, and exactly when the purchase receipt is somewhere else. "2y 3m old" is
          the difference between paying for a repair and buying a replacement, and the app already
          holds `purchased_on`, so withholding it would be withholding an answer it has.

          It sits beside the cover words rather than in the facts list on purpose: "3 years left" and
          "2y 3m old" are two halves of one judgement.
        */}
        {age !== null && <span className="text-meta text-ink-3">{age}</span>}
      </div>

      {/*
        The service line, under a hairline — comp lines 731–735.

        The divider is drawn only when there is a service date, so a thing with no cycle gets no empty
        rule. `serviceOf` is asked here rather than trusting `ServiceLine` to return null, because the
        *divider* is this file's decision and the component's null is not visible to it.
      */}
      {service !== null && (
        <div className="mt-3 border-t border-rule pt-2.5">
          <ServiceLine thing={thing} today={today} />
        </div>
      )}
    </Card>
  )
}

/**
 * `12 Mar 2024 → 12 Mar 2027`, or as much of it as the record actually has.
 *
 * Four cases rather than the comp's two, because a thing may carry either date, both or neither
 * (business rule 1 — `name` is the only required field, and every consumer has to render that
 * gracefully). The comp emits `"Bought " + fmt(undefined)` for a thing with no purchase date, which
 * prints the word "Bought" followed by nothing.
 *
 * `formatDateShort`, not `formatDate`: two long dates and an arrow do not fit beside a tag at 390px.
 */
export function coverSpan(
  purchasedOn: string | null,
  warrantyEndsOn: string | null,
): string | null {
  if (purchasedOn !== null && warrantyEndsOn !== null) {
    return `${formatDateShort(purchasedOn)} → ${formatDateShort(warrantyEndsOn)}`
  }
  // Cover with no purchase date: state where it ends, and do not imply a start we do not have.
  if (warrantyEndsOn !== null) return `Cover to ${formatDateShort(warrantyEndsOn)}`
  if (purchasedOn !== null) return `Bought ${formatDateShort(purchasedOn)}`
  return null
}

/**
 * `"2y 3m old"` — the age, coarsened the way a person says it.
 *
 * Three deliberate differences from the comp's `ageOf()` (line 1901), all of them cases its fixtures
 * cannot reach:
 *
 *  1. **A rounded 12 months carries into a year.** `round((days − y·365) / 30.4)` reaches 12 at 725
 *     days, so the comp prints "1y 12m old" for something two years old. Carrying fixes it.
 *  2. **Under a month is a sentence, not "0 months old".** A thing bought last week is a real state
 *     and the comp's arithmetic makes it read as a bug.
 *  3. **A purchase date in the future returns `null`.** "-1 months old" is worse than saying nothing,
 *     and a mistyped year is the obvious way to get one.
 *
 * 365 and 30.4 rather than calendar arithmetic: this is a rounded phrase, not a date calculation, and
 * `daysUntil` already gives whole calendar days, counted from the user's LOCAL calendar day.
 */
export function ageOf(purchasedOn: string | null, today?: Date): string | null {
  if (purchasedOn === null) return null

  const days = -daysUntil(purchasedOn, today ?? new Date())
  if (days < 0) return null

  let years = Math.floor(days / 365)
  let months = Math.round((days - years * 365) / 30.4)
  if (months === 12) {
    years += 1
    months = 0
  }

  if (years === 0 && months === 0) return 'Less than a month old'
  if (years === 0) return `${months} ${months === 1 ? 'month' : 'months'} old`
  if (months === 0) return `${years} ${years === 1 ? 'year' : 'years'} old`
  return `${years}y ${months}m old`
}
