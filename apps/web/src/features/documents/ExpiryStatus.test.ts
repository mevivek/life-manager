import { COVER_ENDING_DAYS, SERVICE_DUE_DAYS } from '@life-manager/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coverOf, serviceOf } from '@/features/things/CoverStatus'
import { daysUntil, expiryOf, NEEDS_YOU_DAYS } from './ExpiryStatus'

/**
 * **What day is it?** — the one question this file exists to pin down.
 *
 * `daysUntil` is read by three ladders (expiry, cover, service) and by the Now horizon, so a
 * one-day error here is a one-day error in every status the app shows. It used to derive its
 * reference day with `getUTC*`, which is only correct for a user sitting on the Greenwich meridian:
 * at UTC-07:00 an evening render pushed every date a day into the past, and at UTC+05:30 a
 * small-hours render pulled every date a day into the future.
 *
 * ── How the zone is faked ──
 *
 * The suite has no timezone facility, so these tests set one: **`vi.stubEnv('TZ', …)`** (rather than
 * touching `process.env` directly, which does not typecheck — this package's tsconfig declares
 * `vite/client` and no `node` types) plus `vi.setSystemTime` for the instant. Node re-reads `TZ` on
 * each `Date` operation, so the pair together decides what "local" means for the code under test.
 * Injecting a reference `Date` instead would prove nothing: the bug is in how a `Date` is *read*, not
 * in which one is passed, so the runner's own zone has to move.
 *
 * Both directions are covered deliberately. A fix that read local parts on one side only would pass
 * a UTC- test and fail a UTC+ one.
 */

/** Runs `body` with the given zone and instant in force, and restores both afterwards. */
function at(timeZone: string, instantIso: string, body: () => void): void {
  vi.stubEnv('TZ', timeZone)
  vi.useFakeTimers()
  vi.setSystemTime(new Date(instantIso))
  try {
    body()
  } finally {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('“today” is the user’s today, not UTC’s', () => {
  it('does not expire a document that is still valid all day where the user is', () => {
    // 2026-07-31T01:00Z is 30 July, 18:00 in Los Angeles (UTC-07:00). A passport expiring on the
    // 30th is valid for another six hours; the UTC reading called it "Expired 1 day ago".
    at('America/Los_Angeles', '2026-07-31T01:00:00.000Z', () => {
      expect(daysUntil('2026-07-30')).toBe(0)
      const expiry = expiryOf('2026-07-30')
      expect(expiry.state).toBe('today')
      expect(expiry.label).toBe('Expires today')
    })
  })

  it('does not start the “expires today” pulse a day early, west of Greenwich', () => {
    // The other half of the same render: tomorrow must still read as tomorrow. The pulsing ring is
    // the loudest thing in the app and it was firing a day ahead of the date it names.
    at('America/Los_Angeles', '2026-07-31T01:00:00.000Z', () => {
      const expiry = expiryOf('2026-07-31')
      expect(expiry.state).toBe('near')
      expect(expiry.days).toBe(1)
      expect(expiry.label).toBe('in 1 day')
    })
  })

  it('has moved on to the new day east of Greenwich, where UTC has not', () => {
    // The mirror image: 2026-07-30T19:00Z is 31 July, 00:30 in Kolkata (UTC+05:30). Locally the
    // 30th is over, so a document dated the 30th is expired and one dated the 31st is today's.
    at('Asia/Kolkata', '2026-07-30T19:00:00.000Z', () => {
      expect(daysUntil('2026-07-31')).toBe(0)
      expect(expiryOf('2026-07-31').state).toBe('today')

      const yesterday = expiryOf('2026-07-30')
      expect(yesterday.state).toBe('expired')
      expect(yesterday.label).toBe('Expired 1 day ago')
    })
  })

  it('agrees with UTC when the user is on UTC, so nothing moved for the default case', () => {
    // The control. The old behaviour was correct at offset zero, and this pins that the fix is a
    // change of *reference*, not of arithmetic.
    at('Etc/UTC', '2026-07-30T18:00:00.000Z', () => {
      expect(daysUntil('2026-07-30')).toBe(0)
      expect(daysUntil('2026-07-31')).toBe(1)
      expect(daysUntil('2026-07-29')).toBe(-1)
    })
  })

  it('reads the same day either side of a DST transition, because the subtraction is UTC-framed', () => {
    // Los Angeles loses an hour on 8 March 2026. Resolving both operands to a UTC frame keeps every
    // difference an exact multiple of 86,400,000ms, so no day is ever 23 or 25 hours long here.
    at('America/Los_Angeles', '2026-03-07T20:00:00.000Z', () => {
      expect(daysUntil('2026-03-07')).toBe(0)
      expect(daysUntil('2026-03-08')).toBe(1)
      expect(daysUntil('2026-03-09')).toBe(2)
    })
  })
})

describe('the ladders that read daysUntil move with it, and their boundaries do not', () => {
  it('puts the cover and service ladders on the user’s day too', () => {
    // `daysUntil` is shared, so this is the same fix reaching two more status vocabularies. At
    // 18:00 local on 30 July a warranty ending on the 30th has not ended.
    at('America/Los_Angeles', '2026-07-31T01:00:00.000Z', () => {
      expect(coverOf({ purchased_on: '2020-07-30', warranty_ends_on: '2026-07-30' }).state).toBe(
        'ending',
      )
      expect(serviceOf({ service_due_on: '2026-07-30' })?.state).toBe('due')
      // And the day before is genuinely past, in both ladders.
      expect(coverOf({ purchased_on: '2020-07-29', warranty_ends_on: '2026-07-29' }).state).toBe(
        'ended',
      )
      expect(serviceOf({ service_due_on: '2026-07-29' })?.state).toBe('overdue')
    })
  })

  it('leaves all three boundary constants exactly where they were', () => {
    // The fix touches a shared helper, which is the shape of change that moves a threshold by
    // accident. Three numbers, two ladders (design.md §2a rule 3) — none of them may drift.
    expect(NEEDS_YOU_DAYS).toBe(45)
    expect(COVER_ENDING_DAYS).toBe(60)
    expect(SERVICE_DUE_DAYS).toBe(45)
  })
})
