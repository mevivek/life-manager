import { describe, expect, it } from 'vitest'
import { localDay, localStamp } from './datetime'

/**
 * Rendering an instant on the reader's clock.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The zone is PINNED in every assertion, because CI runs in UTC and UTC hides this bug.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A test that lets these helpers read the runner's own zone proves nothing on a UTC box: the local day
 * and the UTC day are the same there, so a `.slice(0, 10)` implementation passes every assertion and
 * ships the off-by-a-day to every real phone. Both directions are pinned instead — `Asia/Kolkata` is
 * ahead of UTC, `America/Los_Angeles` behind it — so each case fails against the naive version no
 * matter where the suite runs.
 *
 * This is the same seam as `today` elsewhere in the codebase: a function that reads an ambient clock
 * cannot be asserted on, so the ambient value becomes an argument with the real one as its default.
 */

const KOLKATA = { timeZone: 'Asia/Kolkata' }
const LA = { timeZone: 'America/Los_Angeles' }

describe('localDay', () => {
  it('is the day it was where the READER is, not where UTC is', () => {
    // 18:00 on the 30th in Los Angeles is already the 31st in UTC…
    expect(localDay('2026-07-31T01:00:00.000Z', LA)).toBe('30 Jul 2026')
    // …and 00:30 on the 31st in Kolkata is still the 30th in UTC.
    expect(localDay('2026-07-30T19:00:00.000Z', KOLKATA)).toBe('31 Jul 2026')
  })

  it('agrees with UTC when the reader is on it', () => {
    expect(localDay('2026-09-12T13:45:00.000Z', { timeZone: 'UTC' })).toBe('12 Sep 2026')
  })

  it('is null for anything it cannot read, rather than a broken string', () => {
    expect(localDay(null)).toBeNull()
    expect(localDay(undefined)).toBeNull()
    expect(localDay('')).toBeNull()
    // `new Date('nonsense')` is an Invalid Date rather than a throw, and formats as "Invalid Date".
    expect(localDay('not a timestamp')).toBeNull()
  })
})

describe('localStamp', () => {
  it('names the zone, so a local time cannot be read as a UTC one', () => {
    // `en-IN` is where CLDR keeps India's abbreviation — see the note on `ZoneOptions.locale`.
    expect(localStamp('2026-07-30T08:15:00.000Z', { ...KOLKATA, locale: 'en-IN' })).toBe(
      '30 Jul 2026, 13:45 IST',
    )
    expect(localStamp('2026-07-30T08:15:00.000Z', { ...LA, locale: 'en-US' })).toBe(
      '30 Jul 2026, 01:15 PDT',
    )
  })

  it('falls back to a GMT offset in a locale with no abbreviation for the zone', () => {
    /**
     * Not a defect, and worth pinning so nobody "fixes" it into a hardcoded table: an abbreviation only
     * exists in the locales that use it. A British reader looking at an Indian clock gets the offset,
     * which is unambiguous — where a made-up "IST" would collide with Irish Summer Time.
     */
    expect(localStamp('2026-07-30T08:15:00.000Z', { ...KOLKATA, locale: 'en-GB' })).toBe(
      '30 Jul 2026, 13:45 GMT+5:30',
    )
  })

  it('keeps the two build halves comparable, in order and in distance', () => {
    // The property the old UTC rendering was thought to protect. One conversion applied to both
    // timestamps cannot reorder them: 08:15 and 09:20 UTC stay 65 minutes apart in every zone.
    expect(localStamp('2026-07-30T08:15:00.000Z', { ...KOLKATA, locale: 'en-IN' })).toBe(
      '30 Jul 2026, 13:45 IST',
    )
    expect(localStamp('2026-07-30T09:20:00.000Z', { ...KOLKATA, locale: 'en-IN' })).toBe(
      '30 Jul 2026, 14:50 IST',
    )
  })

  it('prints midnight as 00:xx, never 24:xx', () => {
    // `hour12: false` resolves to `h24` in several locales and would print "24:10" here — a time no
    // clock shows. `hourCycle: 'h23'` is what makes this pass.
    expect(localStamp('2026-07-29T18:40:00.000Z', { ...KOLKATA, locale: 'en-IN' })).toBe(
      '30 Jul 2026, 00:10 IST',
    )
  })

  it('is null for anything it cannot read', () => {
    expect(localStamp(null)).toBeNull()
    expect(localStamp('not a timestamp')).toBeNull()
  })
})
