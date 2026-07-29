import { cn } from '@/lib/utils'

/**
 * The expiry ladder — five states, readable in greyscale. ADR-0024 §2.
 *
 * This is the one piece of UI that carries the domain's whole point: *is it still valid, and when do
 * I need to do something about it?* So it earns colour where the rest of the app does not.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Each state changes FOUR things at once. Colour is the fourth wheel, not the axle.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The glyph's **shape**, the **words**, the type's **weight**, and its **case** all move together:
 *
 * | state     | glyph              | words                  | type                        |
 * |-----------|--------------------|------------------------|-----------------------------|
 * | `expired` | solid square       | "Expired 6 weeks ago"  | mono 500, UPPER, tracked    |
 * | `today`   | hollow ring, pulse | "Expires today"        | sans 600, sentence case     |
 * | `near`    | gauge, 1 bar of 3  | "in 3 weeks"           | sans 500                    |
 * | `far`     | gauge, 3 bars of 3 | "in 8 months"          | sans 400 — the quietest     |
 * | `none`    | a single dash      | "No expiry"            | sans 400 italic, muted      |
 *
 * That redundancy is the accessibility story: **shape alone separates all five**, so the ladder
 * survives greyscale, colour blindness, and a phone in bright sun. The square is the only
 * solid-filled glyph in the system and the ring is the only circle, both deliberately.
 *
 * The gauge is a fuel gauge for *time* — bars fill as the deadline recedes. **Zero bars is never
 * shown**: at zero the shape changes to a ring instead, which is the entire point of having shapes.
 *
 * ── This file contains no business rule ──
 *
 * The 45-day boundary decides a *glyph and a sentence*, nothing else. What actually fires a
 * notification is `reminders.lead_days`, server-side, at 90/30/7 (invariant 5 — a rule that lived
 * only here would not exist, because Android will not have it). If this threshold and those lead
 * times disagree, the ladder is cosmetically off and the reminders are still right.
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

/**
 * The one boundary between "needs you" and "the horizon".
 *
 * 45 days rather than 30 or 90 — the two thresholds the old badge used. Those existed because the
 * dashboard asked `?expiring_before=` twice, and a single upper bound means everything inside 30
 * days is also inside 90. One boundary, one question.
 */
export const NEEDS_YOU_DAYS = 45

export type ExpiryState = 'expired' | 'today' | 'near' | 'far' | 'none'

export type Expiry = {
  state: ExpiryState
  /** `null` only when there is no expiry date at all. */
  days: number | null
  /** The words. Relative for live states, because the exact date is one tap away. */
  label: string
}

/**
 * Relative distance, coarsening as it grows — nobody needs "in 243 days".
 *
 * ── Two deviations from the comp's own helper, both fixing real bugs ──
 *
 * The prototype switched from months to years at 18 months and emitted `Math.round(days / 365)`
 * unpluralised. That produced two wrong outputs, and a five-year passport hits both:
 *
 *  1. **"18 months" was unreachable.** At exactly 18 months the months branch stopped applying, so the
 *     wording jumped straight from "17 months" to a year count — and 547 days rendered as "1 years".
 *  2. **"1 years" is ungrammatical**, and worse, it *understates*: 548 days is a year and a half, and
 *     calling that "1 year" rounds an expiry date towards sounding further away than it is.
 *
 * So the months band runs to 24 and the year count is pluralised. The band change is what makes the
 * boundary honest — at 24 months `round(days / 365)` is 2, so no year value below 2 can be produced,
 * and "1 year" can never be printed for eighteen months' worth of time.
 */
export function span(days: number): string {
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`
  if (days < 60) return `${Math.round(days / 7)} weeks`
  const months = Math.round(days / 30.4)
  if (months < 24) return `${months} months`
  const years = Math.round(days / 365)
  return `${years} ${years === 1 ? 'year' : 'years'}`
}

/** The same coarsening, past tense. */
export function ago(days: number): string {
  if (days < 14) return `Expired ${days} ${days === 1 ? 'day' : 'days'} ago`
  if (days < 60) return `Expired ${Math.round(days / 7)} weeks ago`
  return `Expired ${Math.round(days / 30.4)} months ago`
}

/** The bucket function. One place decides which of the five states a date is in. */
export function expiryOf(expiresOn: string | null, today = new Date()): Expiry {
  if (expiresOn === null) return { state: 'none', days: null, label: 'No expiry' }

  const days = daysUntil(expiresOn, today)
  if (days < 0) return { state: 'expired', days, label: ago(-days) }
  if (days === 0) return { state: 'today', days, label: 'Expires today' }
  if (days <= NEEDS_YOU_DAYS) return { state: 'near', days, label: `in ${span(days)}` }
  return { state: 'far', days, label: `in ${span(days)}` }
}

/** Whether a document belongs in "Needs you" rather than on the horizon. Expired counts. */
export function needsYou(expiry: Expiry): boolean {
  return expiry.state === 'expired' || expiry.state === 'today' || expiry.state === 'near'
}

const TONE: Record<ExpiryState, string> = {
  expired: 'text-status-late',
  today: 'text-status-late',
  near: 'text-status-soon',
  far: 'text-status-ok',
  none: 'text-status-none',
}

/** The tinted background a detail screen's status block uses. */
export const STATUS_BG: Record<ExpiryState, string> = {
  expired: 'bg-status-late-bg',
  today: 'bg-status-late-bg',
  near: 'bg-status-soon-bg',
  far: 'bg-status-ok-bg',
  none: 'bg-sunken',
}

/**
 * The glyph. `aria-hidden` without exception — the text beside it is the truth, and a screen reader
 * announcing "square" would be describing the drawing rather than the state.
 */
export function ExpiryGlyph({
  state,
  size = 13,
  className,
}: {
  state: ExpiryState
  /** 13px in rows, 15px on a detail screen, 14px in the ladder reference. */
  size?: number
  className?: string
}) {
  const tone = TONE[state]

  if (state === 'expired') {
    return (
      <span
        aria-hidden="true"
        className={cn('block shrink-0 rounded-1 bg-current', tone, className)}
        style={{ width: size, height: size }}
      />
    )
  }

  if (state === 'today') {
    return (
      <span
        aria-hidden="true"
        className={cn(
          'block shrink-0 rounded-full border-[3px] border-current',
          // The one thing in the app that moves on its own. `prefers-reduced-motion` stops it via
          // the global reset in styles.css.
          '[animation:ledger-pulse_2s_ease-in-out_infinite]',
          tone,
          className,
        )}
        style={{ width: size, height: size }}
      />
    )
  }

  if (state === 'none') {
    return (
      <span
        aria-hidden="true"
        className={cn('block shrink-0 bg-current', tone, className)}
        style={{ width: size, height: 2 }}
      />
    )
  }

  // `near` and `far` — the fuel gauge. One bar of three, or three of three.
  const filled = state === 'far' ? 3 : 1
  return (
    <span
      aria-hidden="true"
      className={cn('flex shrink-0 flex-col gap-[2px]', tone, className)}
      style={{ width: size }}
    >
      {/* Top bar first: the gauge fills from the BOTTOM, so `far` reads as a full tank. */}
      {[3, 2, 1].map((bar) => (
        <span
          key={bar}
          className={cn('block rounded-[1px]', bar <= filled ? 'bg-current' : 'bg-rule-2')}
          style={{ width: size, height: 3 }}
        />
      ))}
    </span>
  )
}

const WORDS: Record<ExpiryState, string> = {
  // Mono, uppercase, tracked — it looks like a stamp, which is what an expired document has on it.
  expired: 'font-mono text-meta font-medium uppercase tracking-label',
  today: 'font-sans text-[0.875rem] font-semibold',
  near: 'font-sans text-[0.875rem] font-medium',
  // Deliberately the quietest live state: nothing to do about it yet.
  far: 'font-sans text-[0.875rem] font-normal',
  none: 'font-sans text-[0.875rem] font-normal italic',
}

/** The same words one step larger, for a detail screen's status block. */
const WORDS_LARGE: Record<ExpiryState, string> = {
  expired: 'font-mono text-row font-medium uppercase tracking-label',
  today: 'font-sans text-head font-semibold',
  near: 'font-sans text-head font-medium',
  far: 'font-sans text-head font-normal',
  none: 'font-sans text-[1.125rem] font-normal italic',
}

/** Just the words, in the right type for the state. Used where the glyph is drawn separately. */
export function ExpiryWords({
  expiry,
  size = 'default',
  className,
}: {
  expiry: Expiry
  size?: 'default' | 'large'
  className?: string
}) {
  return (
    <span
      className={cn(
        size === 'large' ? WORDS_LARGE[expiry.state] : WORDS[expiry.state],
        TONE[expiry.state],
        className,
      )}
    >
      {expiry.label}
    </span>
  )
}

/**
 * Glyph plus words, for a row.
 *
 * `title` carries the exact date, since the words are relative. That is a hover affordance on a
 * desktop and nothing at all on a phone, which is why the date is also always present on the detail
 * screen — this is a convenience, not the only route to it.
 */
export function ExpiryStatus({
  expiresOn,
  size = 'default',
  today,
  className,
}: {
  expiresOn: string | null
  size?: 'default' | 'large'
  today?: Date
  className?: string
}) {
  const expiry = expiryOf(expiresOn, today)

  return (
    <span
      className={cn('inline-flex items-center gap-2', className)}
      title={expiresOn === null ? undefined : `Expires ${expiresOn}`}
    >
      <ExpiryGlyph state={expiry.state} size={size === 'large' ? 15 : 13} />
      <ExpiryWords expiry={expiry} size={size} />
    </span>
  )
}

/**
 * The accessible name for a row, per ADR-0024 §8: *"Passport — expires in 6 weeks, 12 September
 * 2026"*. Both the relative distance and the absolute date, because a screen-reader user gets no
 * `title` tooltip and no second glance at the glyph.
 */
export function expiryAccessibleName(
  title: string,
  expiresOn: string | null,
  /** Injectable so this is testable. A function that reads the wall clock cannot be asserted on. */
  today?: Date,
): string {
  if (expiresOn === null) return `${title} — no expiry date`
  const expiry = expiryOf(expiresOn, today)
  return `${title} — ${expiry.label.startsWith('in ') ? `expires ${expiry.label}` : expiry.label}, ${formatDate(expiresOn)}`
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/**
 * `2026-09-12` → `12 September 2026`.
 *
 * Hand-rolled rather than `toLocaleDateString`, because the latter needs a `Date` — and
 * constructing one from a bare `YYYY-MM-DD` parses it as UTC midnight, which renders as the
 * *previous day* for anyone west of Greenwich. The whole domain is calendar dates with no time, so
 * string slicing is both correct and cheaper.
 */
export function formatDate(iso: string): string {
  const month = MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''
  return `${Number(iso.slice(8, 10))} ${month} ${iso.slice(0, 4)}`
}

/** `12 Sep 2026` — the short form, for meta lines and the horizon. */
export function formatDateShort(iso: string): string {
  const month = (MONTHS[Number(iso.slice(5, 7)) - 1] ?? '').slice(0, 3)
  return `${Number(iso.slice(8, 10))} ${month} ${iso.slice(0, 4)}`
}
