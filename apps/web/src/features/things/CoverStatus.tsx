import { COVER_ENDING_DAYS, SERVICE_DUE_DAYS, type Thing } from '@life-manager/shared'
import { daysUntil, formatDate, formatDateShort, span } from '@/features/documents/ExpiryStatus'
import { cn } from '@/lib/utils'

/**
 * The cover ladder — four states. ADR-0029, design.md §2a, things.md §4 rule 2.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  COVER IS NOT EXPIRY, and this file exists so the app cannot say it is.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A document that expires is *invalid*. A dishwasher whose warranty ended **keeps washing dishes**.
 * Reusing `ExpiryStatus`'s ladder for a warranty would make the app lie in its loudest register — a
 * pulsing `today` ring on a warranty lapsing this afternoon says a fridge stops working at midnight.
 *
 * So this is the **second** status vocabulary, and design.md §2a says it is the last one. A third is a
 * smell, and the question to answer before writing it is whether the new dates are really a new *kind*
 * of date or a new *name* for one of these two.
 *
 * | state    | glyph                     | words                  | tone             |
 * |----------|---------------------------|------------------------|------------------|
 * | `active` | depleting bar, proportional | "3 years left"       | `--status-ok`    |
 * | `ending` | the same bar, low         | "Ends in 6 weeks"      | `--status-soon`  |
 * | `ended`  | the bar at zero           | "Ended 20 Jan 2026"    | `--status-late`  |
 * | `none`   | a **dotted rule**, no bar | "No warranty recorded" | `--status-none`  |
 *
 * ── The bar is the whole visual distinction, and it is load-bearing ──
 *
 * A document's gauge is **three discrete bars** counting down to a cliff. A warranty is a **span with
 * a start and an end**, so its glyph is one continuous bar that depletes proportionally. That
 * difference is what lets both ladders sit on one screen (the Now horizon) without competing, and it
 * has to survive greyscale like everything else — which it does, because the two glyphs are different
 * *shapes* rather than the same shape in different colours.
 *
 * ── `ended` states a date, and never alarms ──
 *
 * It never says "Expired" and it never pulses. ADR-0029: it is `--status-late` because that is the
 * palette's "past its date" hue, and **the words carry the difference**. The pulse means "expires
 * today" and belongs to nothing else in the app.
 *
 * That is also why the tone is spent on the *tag* rather than on the sentence: "Ended 20 Jan 2026" in
 * quiet ink beside a small `COVER ENDED` kicker states the fact; the same sentence in red would be an
 * alarm about a dishwasher that still works.
 *
 * ── This file contains no business rule ──
 *
 * `COVER_ENDING_DAYS` (60) and `SERVICE_DUE_DAYS` (45) each decide **a glyph and a sentence**, nothing
 * else. What fires a notification is `reminders.lead_days`, server-side (invariant 5). The two
 * thresholds look like drift and are not — things.md §4 rules 2 and 3 have the reasoning, and the
 * constants live in `packages/shared/src/things.ts` beside the contract they describe.
 *
 * `span`, `formatDate` and `formatDateShort` are **imported** from `ExpiryStatus` rather than
 * reimplemented. They are date formatting, not expiry vocabulary — a second `2026-09-12` →
 * `12 September 2026` would be a second place for the timezone bug that one's comment documents.
 */

export type CoverState = 'active' | 'ending' | 'ended' | 'none'

export type Cover = {
  state: CoverState
  /** `null` only when there is no `warranty_ends_on` at all. Negative once cover has ended. */
  days: number | null
  /** The sentence. Relative while cover is live, an absolute date once it is not. */
  label: string
  /** The short mono kicker: "Covered" · "Cover ends" · "Cover ended" · "No cover". */
  tag: string
  /** 0–100, how much of the cover span is left. `0` for `ended` and for `none`. */
  percentRemaining: number
}

/**
 * Only the two columns cover is derived from, so a caller with a partial row — a test fixture, a
 * future summary response — can ask without constructing a whole `Thing`.
 */
export type CoverInput = Pick<Thing, 'purchased_on' | 'warranty_ends_on'>

/** The bucket function. One place decides which of the four states a warranty is in. */
export function coverOf(thing: CoverInput, today = new Date()): Cover {
  const end = thing.warranty_ends_on
  if (end === null) {
    return {
      state: 'none',
      days: null,
      label: 'No warranty recorded',
      tag: 'No cover',
      percentRemaining: 0,
    }
  }

  const days = daysUntil(end, today)

  if (days < 0) {
    return {
      state: 'ended',
      days,
      // `formatDateShort` — the ladder's one absolute date, and it sits on a 390px row beside a tag
      // and a name. "20 Jan 2026" fits where "20 January 2026" pushes the meta line into a wrap.
      label: `Ended ${formatDateShort(end)}`,
      tag: 'Cover ended',
      percentRemaining: 0,
    }
  }

  const percentRemaining = remainingPercent(thing.purchased_on, days, today)

  if (days <= COVER_ENDING_DAYS) {
    return {
      state: 'ending',
      days,
      // `span(0)` is "0 days", and "Ends in 0 days" is a sentence nobody writes. The comp emits it;
      // this does not. **Note what it deliberately is NOT**: a fifth state. Cover ending today is
      // still `ending` — it does not get the expiry ladder's pulsing ring, because a warranty
      // lapsing this afternoon changes nothing about whether the thing works (ADR-0029).
      label: days === 0 ? 'Ends today' : `Ends in ${span(days)}`,
      tag: 'Cover ends',
      percentRemaining,
    }
  }

  return { state: 'active', days, label: `${span(days)} left`, tag: 'Covered', percentRemaining }
}

/**
 * How much of the span is left, as a percentage.
 *
 * ── When `purchased_on` is null the span is UNKNOWN, and the fallback matters ──
 *
 * The obvious fallback — treat the start as the end, so the total is one day — makes
 * `days / total * 100` enormous, clamps to 100, and draws a **full bar on a warranty ending in three
 * weeks**. The tag and the words would be right and the glyph would contradict them, which is the one
 * failure mode this ladder exists to avoid.
 *
 * So with no purchase date the bar measures the *ending window* instead: full while cover is beyond
 * `COVER_ENDING_DAYS`, depleting through it after that. That is less information than a real span,
 * and it is never wrong in the direction that matters — an ending cover can never read as untouched.
 */
function remainingPercent(purchasedOn: string | null, days: number, today: Date): number {
  if (purchasedOn === null) {
    return days > COVER_ENDING_DAYS ? 100 : clampPercent((days / COVER_ENDING_DAYS) * 100)
  }

  /**
   * The span, as a difference of two day-counts taken against the **same** `today`.
   *
   * `days` is already `daysUntil(end)`, so subtracting `daysUntil(purchased_on)` gives end − start
   * with the reference date cancelling out — no second date parse and no timezone of its own.
   * `max(1, …)` guards a row whose warranty somehow predates its purchase rather than dividing by
   * zero or going negative.
   */
  const total = Math.max(1, days - daysUntil(purchasedOn, today))
  return clampPercent((days / total) * 100)
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

// ── Service ──────────────────────────────────────────────────────────────────

export type ServiceState = 'overdue' | 'due' | 'scheduled'

export type ServiceStatus = {
  state: ServiceState
  days: number
  tag: string
  label: string
}

/**
 * The service date — a **separate** ladder from cover, on a **different** threshold.
 *
 * `SERVICE_DUE_DAYS` is 45 where cover's boundary is 60, and that is things.md §4 rule 3 rather than
 * an inconsistency: a service is an appointment you have to make, which is the same shape of errand as
 * renewing a document, so it borrows the document threshold. A warranty ending is a decision with a
 * longer lead.
 *
 * `null` when the thing has no `service_due_on` — which is the normal state for nine kinds out of ten
 * and is drawn as *absence*, exactly like a missing warranty.
 */
export function serviceOf(
  thing: Pick<Thing, 'service_due_on'>,
  today = new Date(),
): ServiceStatus | null {
  const due = thing.service_due_on
  if (due === null) return null

  const days = daysUntil(due, today)

  if (days < 0) {
    return {
      state: 'overdue',
      days,
      tag: 'Service overdue',
      label: `Was due ${formatDateShort(due)}`,
    }
  }
  if (days <= SERVICE_DUE_DAYS) {
    return {
      state: 'due',
      days,
      tag: 'Service due',
      // Same reason as cover's "Ends today": `in 0 days` is not a sentence.
      label: days === 0 ? 'Due today' : `in ${span(days)}`,
    }
  }
  // Beyond the window the relative phrase says nothing useful ("in 8 months" is not an errand), so
  // the date itself is the more informative thing to print.
  return { state: 'scheduled', days, tag: 'Service due', label: formatDateShort(due) }
}

// ── Tones ────────────────────────────────────────────────────────────────────

const TONE: Record<CoverState, string> = {
  active: 'text-status-ok',
  ending: 'text-status-soon',
  // The palette's "past its date" hue, and correct here. The *words* are what keep this from
  // sounding like an expiry — see the block comment above.
  ended: 'text-status-late',
  // `--status-none` is an alias of `--ink-3`: the absence of cover is drawn as absence, in the same
  // grey as any unfilled value, never as a warning (design.md §4).
  none: 'text-status-none',
}

/**
 * Service tones, and `scheduled` is deliberately `--ink-2` rather than `--status-ok`.
 *
 * A service booked for next spring is not an *all clear* — it is a fact with no colour attached.
 * Spending `--status-ok` on it would put a second green thing on a row that already has one and mean
 * something different by it.
 */
const SERVICE_TONE: Record<ServiceState, string> = {
  overdue: 'text-status-late',
  due: 'text-status-soon',
  scheduled: 'text-ink-2',
}

/** The tinted ground a detail screen's cover block uses. Mirrors `STATUS_BG` in `ExpiryStatus`. */
export const COVER_BG: Record<CoverState, string> = {
  active: 'bg-status-ok-bg',
  ending: 'bg-status-soon-bg',
  ended: 'bg-status-late-bg',
  none: 'bg-sunken',
}

// ── The glyph ────────────────────────────────────────────────────────────────

/**
 * The depleting bar, or a dotted rule when there is no cover at all.
 *
 * `aria-hidden` without exception — the tag and the sentence beside it are the truth, and a screen
 * reader announcing "62 percent" would be describing the drawing rather than the state.
 *
 * ── The arbitrary values here ARE the content (design.md §1) ──
 *
 * `width` is a percentage of the remaining span, which is a datum and cannot come from a token. The
 * track's 34×4 box and 2px radius are the comp's geometry for a glyph, in the same class as
 * `ExpiryGlyph`'s 13px square: a size small enough that a `--radius-*` step would round it out of
 * existence.
 */
export function CoverBar({
  cover,
  /** 34px on a row, wider on a detail screen's cover card. */
  width = 34,
  className,
}: {
  cover: Cover
  width?: number
  className?: string
}) {
  if (cover.state === 'none') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'block shrink-0 border-t-2 border-dotted border-current',
          TONE.none,
          className,
        )}
        style={{ width }}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'block shrink-0 overflow-hidden rounded-[2px] bg-rule-2',
        TONE[cover.state],
        className,
      )}
      style={{ width, height: 4 }}
    >
      <span
        className="block h-full rounded-[2px] bg-current"
        style={{ width: `${cover.percentRemaining}%` }}
      />
    </span>
  )
}

/** The mono kicker. The one place the tone is spent, so a row carries colour once. */
export function CoverTag({ cover, className }: { cover: Cover; className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-label font-medium uppercase tracking-label',
        TONE[cover.state],
        className,
      )}
    >
      {cover.tag}
    </span>
  )
}

/**
 * The sentence, in the type its state calls for.
 *
 * Four states, four looks, so the ladder reads in greyscale: the two live states differ in weight,
 * `ended` is medium (a stated fact, not a shout), and `none` is italic — the same "this value is
 * absent" idiom the expiry ladder's `none` uses.
 */
const WORDS: Record<CoverState, string> = {
  // The quietest state: cover is fine and there is nothing to do about it.
  active: 'font-sans font-normal',
  ending: 'font-sans font-medium',
  ended: 'font-sans font-medium',
  none: 'font-sans font-normal italic',
}

export function CoverWords({
  cover,
  size = 'default',
  className,
}: {
  cover: Cover
  size?: 'default' | 'large'
  className?: string
}) {
  return (
    <span
      className={cn(
        WORDS[cover.state],
        size === 'large' ? 'text-head text-ink' : 'text-meta text-ink-3',
        className,
      )}
    >
      {cover.label}
    </span>
  )
}

/**
 * Bar · tag · words — the whole ladder, for a row or a card.
 *
 * `title` carries the exact date, because the sentence is relative in two of the four states. A hover
 * affordance on a desktop and nothing at all on a phone, which is why the detail screen prints the
 * date outright — this is a convenience, never the only route to it.
 */
export function CoverStatus({
  thing,
  size = 'default',
  today,
  className,
}: {
  thing: CoverInput
  size?: 'default' | 'large'
  today?: Date
  className?: string
}) {
  const cover = coverOf(thing, today)

  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-2', className)}
      title={thing.warranty_ends_on === null ? undefined : `Cover ends ${thing.warranty_ends_on}`}
    >
      <CoverBar cover={cover} width={size === 'large' ? 60 : 34} />
      <CoverTag cover={cover} />
      <CoverWords cover={cover} size={size} className="min-w-0 truncate" />
    </span>
  )
}

/** The service line's tag and words, for a row. Renders nothing when there is no service cycle. */
export function ServiceLine({
  thing,
  today,
  className,
}: {
  thing: Pick<Thing, 'service_due_on'>
  today?: Date
  className?: string
}) {
  const service = serviceOf(thing, today)
  if (service === null) return null

  return (
    <span className={cn('flex items-baseline gap-[7px]', className)}>
      <span
        className={cn(
          'shrink-0 font-mono text-label font-medium uppercase tracking-label',
          SERVICE_TONE[service.state],
        )}
      >
        {service.tag}
      </span>
      <span className="min-w-0 truncate text-meta text-ink-2">{service.label}</span>
    </span>
  )
}

/**
 * The accessible name for a row — the cover equivalent of `expiryAccessibleName`.
 *
 * The glyph is `aria-hidden`, so this is where the state actually exists for a screen reader. It
 * spells out **the state in words and the absolute date**, per design.md §9: a screen-reader user gets
 * no `title` tooltip and no second glance at a 34px bar.
 *
 * `formatDate`, not `formatDateShort` — "20 January 2026" is read correctly aloud where "20 Jan 2026"
 * is a gamble on the synthesiser expanding an abbreviation.
 */
export function coverAccessibleName(
  name: string,
  thing: CoverInput,
  /** Injectable so this is testable. A function that reads the wall clock cannot be asserted on. */
  today?: Date,
): string {
  const end = thing.warranty_ends_on
  if (end === null) return `${name} — no warranty recorded`

  const cover = coverOf(thing, today)
  const spoken =
    cover.state === 'ended'
      ? 'cover ended'
      : cover.days === 0
        ? 'cover ends today'
        : `cover ends in ${span(cover.days ?? 0)}`

  return `${name} — ${spoken}, ${formatDate(end)}`
}
