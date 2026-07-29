import type { Document } from '@life-manager/shared'
import { describe, expect, it } from 'vitest'
import { toLedger } from './useLedger'

/**
 * `toLedger` is the Now screen's whole information architecture in one function, so it gets tested
 * directly rather than through the screen.
 *
 * The partition is the part most likely to break silently: a mis-sorted or mis-bucketed row does not
 * throw, it just puts a passport that expires next week on "the horizon" and reports "nothing needs
 * you today" — a wrong answer that looks exactly like a right one.
 */

const TODAY = new Date('2026-07-29T12:00:00.000Z')

function iso(days: number): string {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** A document with only the fields the ledger reads; the rest is filler the partition ignores. */
function doc(overrides: Partial<Document> & { id: string }): Document {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
    title: overrides.id,
    doc_type: 'other',
    issuer: null,
    identifier_last4: null,
    issued_on: null,
    expires_on: null,
    country: null,
    notes: null,
    tags: [],
    custom_attrs: {},
    file_count: 1,
    // ADR-0024's precondition column. The ledger never reads it, but `Document` requires it — and
    // `version: 1` is what a freshly created document actually carries, so the fixture stays honest.
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('toLedger', () => {
  it('splits a page into needs-you, the horizon and the undated', () => {
    const ledger = toLedger(
      [
        doc({ id: 'expired', expires_on: iso(-30) }),
        doc({ id: 'today', expires_on: iso(0) }),
        doc({ id: 'near', expires_on: iso(20) }),
        doc({ id: 'far', expires_on: iso(400) }),
        doc({ id: 'undated' }),
      ],
      null,
      TODAY,
    )

    expect(ledger.needsYou.map((row) => row.document.id)).toEqual(['expired', 'today', 'near'])
    expect(ledger.horizon.map((row) => row.document.id)).toEqual(['far'])
    expect(ledger.undated.map((row) => row.document.id)).toEqual(['undated'])
  })

  it('keeps an expired document in needs-you rather than dropping it', () => {
    // The bug this guards: "expiring within 45 days" implemented as an upper bound only, with no
    // thought for the lower one. A passport that ran out last month is the single most important row
    // on the screen, and a naive filter puts it nowhere at all.
    const ledger = toLedger([doc({ id: 'lapsed', expires_on: iso(-400) })], null, TODAY)
    expect(ledger.needsYou).toHaveLength(1)
    expect(ledger.horizon).toHaveLength(0)
  })

  it('counts documents with a date, and does not count the undated among them', () => {
    const ledger = toLedger(
      [
        doc({ id: 'a', expires_on: iso(10) }),
        doc({ id: 'b', expires_on: iso(500) }),
        doc({ id: 'c' }),
        doc({ id: 'd' }),
      ],
      null,
      TODAY,
    )

    // Q1: an undated document is a normal thing to own, and it is not something we watch. The ledger
    // footer says "N with a date we watch", so counting the undated there would be a false claim.
    expect(ledger.datedCount).toBe(2)
    expect(ledger.loadedCount).toBe(4)
  })

  it('collects the documents with no scan, whatever bucket they landed in', () => {
    const ledger = toLedger(
      [
        doc({ id: 'dated-no-scan', expires_on: iso(10), file_count: 0 }),
        doc({ id: 'undated-no-scan', file_count: 0 }),
        doc({ id: 'has-scan', file_count: 2 }),
      ],
      null,
      TODAY,
    )

    // `file_count` is denormalised on the list response precisely so this needs no N+1. It was 0 for
    // every document through all of M1 because every test happened to expect 0 (debt D33) — so this
    // asserts a NON-ZERO count as well as the zero ones.
    expect(ledger.withoutScan.map((document) => document.id)).toEqual([
      'dated-no-scan',
      'undated-no-scan',
    ])
    expect(ledger.loadedCount).toBe(3)
  })

  it('reports completeness from the cursor, which is what keeps the footer honest', () => {
    // With a next cursor, every count is a floor rather than a total — the API has no count endpoint,
    // so the screen must say "12+" rather than "12". This flag is the only thing that knows.
    expect(toLedger([doc({ id: 'a' })], null, TODAY).complete).toBe(true)
    expect(toLedger([doc({ id: 'a' })], 'cursor-abc', TODAY).complete).toBe(false)
  })

  it('preserves the API’s soonest-first order within each bucket', () => {
    // The partition is a walk over an already-sorted page (`sort=expires_on&order=asc`), so it must
    // not reorder. If it ever sorts internally, that is a second ordering to keep in step with the
    // server's.
    const ledger = toLedger(
      [
        doc({ id: 'soonest', expires_on: iso(2) }),
        doc({ id: 'later', expires_on: iso(30) }),
        doc({ id: 'far-soon', expires_on: iso(100) }),
        doc({ id: 'far-late', expires_on: iso(900) }),
      ],
      null,
      TODAY,
    )

    expect(ledger.needsYou.map((row) => row.document.id)).toEqual(['soonest', 'later'])
    expect(ledger.horizon.map((row) => row.document.id)).toEqual(['far-soon', 'far-late'])
  })

  it('makes the soonest STILL-FUTURE date findable, which the push ask depends on', () => {
    // The bug this guards: the Now screen named `needsYou[0]` in the push ask. `needsYou` is
    // soonest-first and includes ALREADY-EXPIRED documents, so the ask read "Your first aid
    // certificate expires 14 June 2026. We can send a notification 90, 30 and 7 days before" about a
    // date six weeks in the past — offering to warn someone ahead of something that already happened.
    //
    // The fix scans for the first row with `days >= 0`, so this asserts the ordering makes that
    // possible: expired rows come first, and a future one is reachable behind them.
    const ledger = toLedger(
      [
        doc({ id: 'lapsed', expires_on: iso(-42) }),
        doc({ id: 'upcoming', expires_on: iso(14) }),
        doc({ id: 'distant', expires_on: iso(400) }),
      ],
      null,
      TODAY,
    )

    const all = [...ledger.needsYou, ...ledger.horizon]
    expect(all[0]?.document.id).toBe('lapsed')

    const nextFuture = all.find((row) => row.expiry.days !== null && row.expiry.days >= 0)
    expect(nextFuture?.document.id).toBe('upcoming')
  })

  it('exposes days on every dated row, so "already passed" is decidable', () => {
    const ledger = toLedger([doc({ id: 'lapsed', expires_on: iso(-1) })], null, TODAY)
    // `days` is negative for the past and 0 today — the only signal that distinguishes "expired" from
    // "expires today" without re-parsing the date string at the call site.
    expect(ledger.needsYou[0]?.expiry.days).toBe(-1)
    expect(
      toLedger([doc({ id: 'now', expires_on: iso(0) })], null, TODAY).needsYou[0]?.expiry.days,
    ).toBe(0)
    expect(toLedger([doc({ id: 'undated' })], null, TODAY).undated[0]?.expiry.days).toBeNull()
  })

  it('handles an empty archive without inventing rows', () => {
    const ledger = toLedger([], null, TODAY)
    expect(ledger.loadedCount).toBe(0)
    expect(ledger.needsYou).toEqual([])
    expect(ledger.horizon).toEqual([])
    expect(ledger.datedCount).toBe(0)
    // `complete` is true for an empty first page: there genuinely is nothing more.
    expect(ledger.complete).toBe(true)
  })
})
