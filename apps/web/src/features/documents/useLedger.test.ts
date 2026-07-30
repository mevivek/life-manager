import type { Document, Thing } from '@life-manager/shared'
import { describe, expect, it } from 'vitest'
import { expiryOf } from './ExpiryStatus'
import { buildHorizon, toLedger } from './useLedger'

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
    holder: null,
    relation: null,
    // ADR-0027: the full value is on every document response, including the list.
    identifier: null,
    identifier_last4: null,
    // ADR-0029: unlinked. The ledger partition does not read it, but the shape requires it.
    thing_id: null,
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

/**
 * A thing with only the fields the horizon reads. `ownership: 'here'` is the default state a thing is
 * created in, so the fixture starts where a real row does.
 */
function thing(overrides: Partial<Thing> & { id: string; name: string }): Thing {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
    kind: 'appliance',
    brand: null,
    model: null,
    serial: null,
    serial_last4: null,
    purchased_on: null,
    price: null,
    currency: null,
    warranty_ends_on: null,
    service_every_months: null,
    service_due_on: null,
    kept_at: null,
    holder: null,
    relation: null,
    ownership: 'here',
    ownership_who: null,
    ownership_since: null,
    notes: null,
    document_count: 0,
    photo_count: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** The document horizon in the shape `buildHorizon` takes — already partitioned and `far`. */
function row(document: Document) {
  return { document, expiry: expiryOf(document.expires_on, TODAY) }
}

/**
 * `buildHorizon` is the cross-domain merge, and it is where the interesting mistakes live: a wrong
 * exclusion silently drops a warranty off the only screen that would have warned about it, and a wrong
 * sort puts next spring above next week without anything throwing.
 *
 * ADR-0029, design.md §8, things.md §4 rules 2–4.
 */
describe('buildHorizon', () => {
  it('interleaves documents and thing events in date order, on one timeline', () => {
    const entries = buildHorizon(
      [row(doc({ id: 'passport', title: 'Passport', expires_on: iso(200) }))],
      [
        thing({ id: 'boiler', name: 'Boiler', warranty_ends_on: iso(100) }),
        thing({ id: 'volvo', name: 'Volvo V60', service_due_on: iso(300) }),
      ],
      TODAY,
    )

    // The whole point of ADR-0025 §4: not documents-then-things, not two sections — one list sorted by
    // date, so the answer to "what is next" needs no domain chosen first.
    expect(entries).toHaveLength(3)
    expect(entries.map((entry) => entry.title)).toEqual(['Boiler', 'Passport', 'Volvo V60'])
  })

  it('gives a thing event a kicker and a document none — the distinction is not decorative', () => {
    const entries = buildHorizon(
      [row(doc({ id: 'passport', title: 'Passport', expires_on: iso(100) }))],
      [
        thing({ id: 'boiler', name: 'Boiler', warranty_ends_on: iso(200) }),
        thing({ id: 'volvo', name: 'Volvo V60', service_due_on: iso(300) }),
      ],
      TODAY,
    )

    // `null` is the distinction, not a missing string: a document needs no kicker because an expiry is
    // what this timeline is by default. If a document ever gains one, the two kinds become symmetric
    // and the shape difference stops meaning anything (design.md §8).
    expect(entries.map((entry) => entry.kicker)).toEqual([null, 'Warranty ends', 'Service due'])
    expect(entries.map((entry) => entry.entity)).toEqual(['document', 'thing', 'thing'])
  })

  it('leaves a `gone` thing off the timeline, warranty and all', () => {
    // things.md §4 rule 4: a warranty on somebody else's dishwasher is not your deadline. The record
    // stays in Things — it is dimmed, not hidden — but it is not a date you have to act on.
    const entries = buildHorizon(
      [],
      [
        thing({
          id: 'sold',
          name: 'Old dishwasher',
          ownership: 'gone',
          warranty_ends_on: iso(100),
          service_due_on: iso(120),
        }),
      ],
      TODAY,
    )
    expect(entries).toEqual([])
  })

  it('keeps a `lent` thing ON the timeline, because it is still yours', () => {
    // The other half of rule 4, and the one an over-eager filter breaks: `lent` means yours and
    // elsewhere, so its reminders and its dates carry on.
    const entries = buildHorizon(
      [],
      [
        thing({
          id: 'lent-drill',
          name: 'Drill',
          ownership: 'lent',
          ownership_who: 'Sam',
          warranty_ends_on: iso(90),
        }),
      ],
      TODAY,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.title).toBe('Drill')
  })

  it('drops cover that has already ended and a service already overdue', () => {
    // This is a FORWARD timeline. Something past is either urgent (and belongs above, in Needs you) or
    // history — either way, putting it here would make "the horizon" mean "every date we hold".
    const entries = buildHorizon(
      [],
      [
        thing({
          id: 'old',
          name: 'Kettle',
          warranty_ends_on: iso(-30),
          service_due_on: iso(-5),
        }),
      ],
      TODAY,
    )
    expect(entries).toEqual([])
  })

  it('includes a warranty ending TODAY, where the comp excluded it', () => {
    // The comp's own `buildHorizon` guards `w.days > 0`, so a warranty lapsing this afternoon appears
    // nowhere at all — on the one day it is worth reading. The cover ladder has no `today` state to
    // catch it either (deliberately: a lapsing warranty is not a pulsing emergency, ADR-0029), so the
    // timeline is the only place it can be said. It says it quietly.
    const entries = buildHorizon(
      [],
      [thing({ id: 'today', name: 'Microwave', warranty_ends_on: iso(0) })],
      TODAY,
    )
    expect(entries).toHaveLength(1)
    expect(entries[0]?.when).toContain('today')
    expect(entries[0]?.kicker).toBe('Warranty ends')
  })

  it('gives one thing two entries when it has both a warranty and a service ahead', () => {
    const entries = buildHorizon(
      [],
      [
        thing({
          id: 'car',
          name: 'Volvo V60',
          kind: 'vehicle',
          brand: 'Volvo',
          warranty_ends_on: iso(400),
          service_due_on: iso(20),
        }),
      ],
      TODAY,
    )

    // Two entries from one row, which is why the key cannot be the thing's id — React would collapse
    // them into one and the second date would silently vanish.
    expect(entries).toHaveLength(2)
    expect(new Set(entries.map((entry) => entry.key)).size).toBe(2)
    expect(entries.map((entry) => entry.kicker)).toEqual(['Service due', 'Warranty ends'])
    // Both point at the same screen, and the meta names the kind and the make.
    expect(entries.every((entry) => entry.entity === 'thing')).toBe(true)
    expect(entries[0]?.meta).toBe('Vehicle · Volvo')
  })

  it('takes its tone from the cover and service ladders, never from the expiry one', () => {
    const entries = buildHorizon(
      [],
      [
        // Inside COVER_ENDING_DAYS (60) — `ending`, so `soon`. Note 50 days is NOT inside
        // NEEDS_YOU_DAYS (45), which is exactly why cover cannot borrow the expiry ladder.
        thing({ id: 'ending', name: 'Fridge', warranty_ends_on: iso(50) }),
        // Beyond it — `active`, so `ok`.
        thing({ id: 'active', name: 'Boiler', warranty_ends_on: iso(500) }),
        // Beyond SERVICE_DUE_DAYS (45) — `scheduled`, which is deliberately QUIET rather than `ok`: a
        // service booked for next spring is a fact, not an all-clear.
        thing({ id: 'scheduled', name: 'Volvo', service_due_on: iso(300) }),
      ],
      TODAY,
    )

    const tones = new Map(entries.map((entry) => [entry.title, entry.tone]))
    expect(tones.get('Fridge')).toBe('soon')
    expect(tones.get('Boiler')).toBe('ok')
    expect(tones.get('Volvo')).toBe('quiet')
  })

  it('spells the state out in words for both kinds, because the dot is aria-hidden', () => {
    const entries = buildHorizon(
      // Absolute dates rather than `iso(n)`, because the expected strings below spell out both the
      // month name and the coarsened distance — with an offset the reader would have to do the
      // arithmetic to know whether the assertion is right.
      [row(doc({ id: 'p', title: 'Passport', expires_on: '2027-02-14' }))],
      [
        thing({ id: 'b', name: 'Boiler', warranty_ends_on: '2027-03-14' }),
        thing({ id: 'v', name: 'Volvo V60', service_due_on: '2027-06-01' }),
      ],
      TODAY,
    )

    // design.md §9: the relative distance AND the absolute date, in words, for every entry — a
    // screen-reader user gets no glance at the glyph and no tooltip. And "warranty ends" / "service
    // due" rather than "expires", which is the ADR-0029 distinction said out loud.
    expect(entries[0]?.accessibleName).toBe('Passport — expires in 7 months, 14 February 2027')
    expect(entries[1]?.accessibleName).toBe('Boiler — warranty ends in 8 months, 14 March 2027')
    expect(entries[2]?.accessibleName).toBe('Volvo V60 — service due in 10 months, 1 June 2027')
  })

  it('degrades to documents only when the things list could not be read', () => {
    // The single most important robustness property on the Now screen: there is no Things API yet
    // (things.md §10), so the caller passes `[]` on failure and the timeline is exactly what it was
    // before the domain existed. A NON-ZERO count, deliberately (debt D33).
    const entries = buildHorizon(
      [
        row(doc({ id: 'a', title: 'Passport', expires_on: iso(100) })),
        row(doc({ id: 'b', title: 'Licence', expires_on: iso(300) })),
      ],
      [],
      TODAY,
    )
    expect(entries).toHaveLength(2)
    expect(entries.every((entry) => entry.entity === 'document')).toBe(true)
    expect(entries.every((entry) => entry.kicker === null)).toBe(true)
  })
})
