import { COVER_ENDING_DAYS, SERVICE_DUE_DAYS } from '@life-manager/shared'
import { describe, expect, it } from 'vitest'
import { expiryOf, NEEDS_YOU_DAYS } from '@/features/documents/ExpiryStatus'
import { COVER_BG, coverAccessibleName, coverOf, serviceOf } from './CoverStatus'

/**
 * The cover ladder, tested as arithmetic.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  What these tests actually defend: that cover never borrows the expiry vocabulary.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0029's central claim is that a warranty ending is not an expiry, and the cheapest way to break it
 * is a well-meaning edit that reuses a word — "Expired", "Expires today" — or the 45-day boundary. Both
 * would leave the app *working*, with a passing render test and a correct accessible name, and would
 * say something false in the loudest register the design has. So the words are asserted literally and
 * the two thresholds are asserted to be different numbers.
 *
 * `TODAY` is fixed so every assertion is arithmetic rather than a race with the clock — the same
 * discipline `useLedger.test.ts` uses, and for the same reason.
 */

const TODAY = new Date('2026-07-30T12:00:00.000Z')

/** `days` from TODAY, as the `YYYY-MM-DD` the API returns. */
function iso(days: number): string {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Only the fields the ladder reads. Everything else about a `Thing` is irrelevant here. */
function cover(purchasedOn: string | null, warrantyEndsOn: string | null) {
  return coverOf({ purchased_on: purchasedOn, warranty_ends_on: warrantyEndsOn }, TODAY)
}

describe('the four cover states', () => {
  it('is active beyond the ending window, and says how long is left', () => {
    const result = cover(iso(-365), iso(730))

    expect(result.state).toBe('active')
    expect(result.tag).toBe('Covered')
    expect(result.label).toBe('2 years left')
    expect(result.days).toBe(730)
  })

  it('is ending inside the window, and says when it ends', () => {
    const result = cover(iso(-365), iso(42))

    expect(result.state).toBe('ending')
    expect(result.tag).toBe('Cover ends')
    expect(result.label).toBe('Ends in 6 weeks')
  })

  it('is ended past the date, and states the date — never “Expired”', () => {
    const result = cover(iso(-1000), iso(-191))

    expect(result.state).toBe('ended')
    expect(result.tag).toBe('Cover ended')
    // The whole of ADR-0029 in one assertion. A dishwasher whose warranty ended keeps washing dishes,
    // so `ended` states a date; "Expired" would be the expiry ladder's word for "this is now invalid".
    expect(result.label).toBe('Ended 20 Jan 2026')
    expect(result.label).not.toContain('Expired')
    expect(result.label).not.toContain('expired')
  })

  it('is none when there is no warranty at all, and calls that a normal state', () => {
    const result = cover(iso(-100), null)

    expect(result.state).toBe('none')
    expect(result.tag).toBe('No cover')
    expect(result.label).toBe('No warranty recorded')
    // `null` days rather than 0: there is no countdown, which is different from a countdown at zero.
    expect(result.days).toBeNull()
    expect(result.percentRemaining).toBe(0)
  })

  it('does not treat cover ending today as a fifth, louder state', () => {
    const result = cover(iso(-365), iso(0))

    // Still `ending`. The expiry ladder's `today` state pulses, and design.md §2a is explicit that the
    // pulse means "expires today" and belongs to nothing else — a warranty lapsing this afternoon
    // changes nothing about whether the thing works.
    expect(result.state).toBe('ending')
    // And not "Ends in 0 days", which is what a naive `span(0)` produces.
    expect(result.label).toBe('Ends today')
  })
})

describe('the 60-day boundary', () => {
  it('is ending at exactly 60 days and active at 61', () => {
    // The boundary itself, both sides. `<=` rather than `<` is the difference between these two lines.
    expect(cover(iso(-365), iso(COVER_ENDING_DAYS)).state).toBe('ending')
    expect(cover(iso(-365), iso(COVER_ENDING_DAYS + 1)).state).toBe('active')
  })

  it('is 60 for cover and 45 for a document, and those are deliberately different numbers', () => {
    // things.md §4 rule 2: the useful action on an ending warranty has a longer lead than renewing a
    // passport. If someone "tidies" these into one constant, this fails and points at the ADR.
    expect(COVER_ENDING_DAYS).toBe(60)
    expect(NEEDS_YOU_DAYS).toBe(45)
    expect(COVER_ENDING_DAYS).not.toBe(NEEDS_YOU_DAYS)

    // The same distance through both ladders, which is the clearest statement of why there are two: a
    // thing 50 days from cover end wants attention; a document 50 days from expiry is on the horizon.
    expect(cover(iso(-365), iso(50)).state).toBe('ending')
    expect(expiryOf(iso(50), TODAY).state).toBe('far')
  })
})

describe('the proportional bar', () => {
  it('is the fraction of the span remaining, for a known span', () => {
    // Bought 730 days ago, cover runs another 730: exactly half the span is left.
    expect(cover(iso(-730), iso(730)).percentRemaining).toBe(50)

    // A quarter through a four-year cover leaves three quarters.
    expect(cover(iso(-365), iso(1095)).percentRemaining).toBe(75)

    // Nearly gone, and the bar says so rather than rounding up to comfortable.
    expect(cover(iso(-1000), iso(10)).percentRemaining).toBe(1)
  })

  it('is zero once cover has ended, whatever the span was', () => {
    expect(cover(iso(-1000), iso(-1)).percentRemaining).toBe(0)
    expect(cover(iso(-1000), iso(-500)).percentRemaining).toBe(0)
  })

  it('never draws a full bar on an ending warranty when the purchase date is unknown', () => {
    /**
     * The regression this exists for. Treating the missing start as the end makes the total one day, so
     * `days / total * 100` clamps to 100 — a **full bar** beside the words "Ends in 4 weeks". The
     * fallback measures the ending window instead, so the glyph and the sentence agree.
     */
    const ending = cover(null, iso(30))
    expect(ending.state).toBe('ending')
    expect(ending.percentRemaining).toBe(50)
    expect(ending.percentRemaining).toBeLessThan(100)

    // Beyond the window it is full, which is honest: there is nothing to deplete against.
    expect(cover(null, iso(400)).percentRemaining).toBe(100)
  })

  it('does not divide by zero or go negative when a warranty predates its purchase', () => {
    // Bad data rather than a real case, and it must not produce NaN in a style attribute.
    const result = cover(iso(10), iso(-5))
    expect(result.state).toBe('ended')
    expect(Number.isFinite(result.percentRemaining)).toBe(true)
    expect(result.percentRemaining).toBeGreaterThanOrEqual(0)
  })
})

describe('serviceOf', () => {
  const service = (dueOn: string | null) => serviceOf({ service_due_on: dueOn }, TODAY)

  it('is null when the thing has no service cycle', () => {
    // Nine kinds out of ten. Drawn as absence, exactly like a missing warranty.
    expect(service(null)).toBeNull()
  })

  it('reads overdue, due and scheduled off the 45-day threshold', () => {
    expect(service(iso(-3))?.state).toBe('overdue')
    expect(service(iso(-3))?.tag).toBe('Service overdue')
    expect(service(iso(-3))?.label).toBe('Was due 27 Jul 2026')

    expect(service(iso(20))?.state).toBe('due')
    expect(service(iso(20))?.label).toBe('in 3 weeks')

    // The boundary, both sides — and it is cover's 60 that does NOT apply here.
    expect(service(iso(SERVICE_DUE_DAYS))?.state).toBe('due')
    expect(service(iso(SERVICE_DUE_DAYS + 1))?.state).toBe('scheduled')
    expect(SERVICE_DUE_DAYS).toBe(45)
  })

  it('prints the date rather than a relative phrase once it is not an errand', () => {
    // "in 8 months" is not something you can book. The date is.
    expect(service(iso(240))?.label).toBe('27 Mar 2027')
    expect(service(iso(0))?.label).toBe('Due today')
  })
})

describe('coverAccessibleName', () => {
  it('spells out the state in words and gives the absolute date', () => {
    // design.md §9: the glyph is aria-hidden, so this is where the state exists for a screen reader —
    // and it carries BOTH the distance and the date, because there is no tooltip on a phone.
    expect(
      coverAccessibleName(
        'Bosch dishwasher',
        { purchased_on: iso(-365), warranty_ends_on: iso(42) },
        TODAY,
      ),
    ).toBe('Bosch dishwasher — cover ends in 6 weeks, 10 September 2026')

    expect(
      coverAccessibleName(
        'Volkswagen Golf',
        { purchased_on: iso(-2000), warranty_ends_on: iso(-191) },
        TODAY,
      ),
    ).toBe('Volkswagen Golf — cover ended, 20 January 2026')

    expect(
      coverAccessibleName('Gold chain', { purchased_on: null, warranty_ends_on: null }, TODAY),
    ).toBe('Gold chain — no warranty recorded')
  })

  it('never says “expires” or “expired” in a name a screen reader reads aloud', () => {
    // The failure this catches is a copy edit, not a logic bug: someone reaching for the familiar word
    // in the one string that is only ever heard rather than seen.
    for (const days of [-400, -1, 0, 30, 900]) {
      const name = coverAccessibleName(
        'Thing',
        { purchased_on: iso(-1000), warranty_ends_on: iso(days) },
        TODAY,
      )
      expect(name.toLowerCase()).not.toContain('expir')
    }
  })
})

describe('COVER_BG', () => {
  it('covers all four states, and draws “no cover” as absence rather than as a warning', () => {
    // A missing key would render a tinted block with no tint and no error — so the map is walked.
    expect(Object.keys(COVER_BG)).toHaveLength(4)
    expect(COVER_BG.active).toBe('bg-status-ok-bg')
    expect(COVER_BG.ending).toBe('bg-status-soon-bg')
    expect(COVER_BG.ended).toBe('bg-status-late-bg')
    // `--sunken`, not a status tint: design.md §4 draws the absence of a countdown as absence.
    expect(COVER_BG.none).toBe('bg-sunken')
  })
})
