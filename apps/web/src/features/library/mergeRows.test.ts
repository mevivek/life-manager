import type { Document, Thing } from '@life-manager/shared'
import { describe, expect, it } from 'vitest'
import { type LibraryRow, mergeRows, rowWhen } from './mergeRows'

/**
 * The merge is the one piece of genuinely new behaviour in ADR-0032 — everything else on the library
 * screen is two existing screens under a scope switch. So it gets the tests.
 *
 * These are pure-function tests with no renderer, deliberately: the ordering rules are the thing that
 * can be wrong in a way a screenshot would not reveal, because a plausible-looking list and a correct
 * one are the same picture until you check what is at the top.
 */

const SPACE = '22222222-2222-4222-8222-222222222222'

/**
 * Whole records, not `as Document` on a convenient subset — the convention `things.test.tsx` states.
 *
 * A cast would typecheck against a shape that does not exist, so a renamed or removed field would go
 * on compiling here while the real screen broke. The defaults are the *sparse* case on purpose: one
 * required field and nothing else is a completely normal record to own (Q2), and the undated ordering
 * rule below is precisely about those.
 */
function document(over: Partial<Document> & { id: string; title: string }): Document {
  return {
    space_id: SPACE,
    doc_type: 'other',
    issuer: null,
    holder: null,
    relation: null,
    identifier: null,
    thing_id: null,
    issued_on: null,
    expires_on: null,
    country: null,
    notes: null,
    tags: [],
    custom_attrs: {},
    file_count: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function thing(over: Partial<Thing> & { id: string; name: string }): Thing {
  return {
    space_id: SPACE,
    kind: 'other',
    brand: null,
    model: null,
    serial: null,
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
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  }
}

/** The visible names, in order — what a reader of the screen would see top to bottom. */
function order(rows: LibraryRow[]): string[] {
  return rows.map((row) => (row.kind === 'document' ? row.document.title : row.thing.name))
}

describe('what a row is dated by', () => {
  it('dates a document by its expiry', () => {
    expect(
      rowWhen({
        kind: 'document',
        id: 'd1',
        document: document({ id: 'd1', title: 'Passport', expires_on: '2026-09-12' }),
      }),
    ).toBe('2026-09-12')
  })

  it('dates a thing by its warranty when that is the only clock', () => {
    expect(
      rowWhen({
        kind: 'thing',
        id: 't1',
        thing: thing({ id: 't1', name: 'Dishwasher', warranty_ends_on: '2028-05-18' }),
      }),
    ).toBe('2028-05-18')
  })

  /**
   * The case that makes `thingWhen` more than a field read, and the reason it is not just
   * `warranty_ends_on`: a car whose warranty lapsed years ago still has a service due next month.
   * Sorting it by the dead warranty buries the live date beneath every document in the archive.
   */
  it('dates a thing by whichever of cover-end and service-due comes FIRST', () => {
    const car = thing({
      id: 't2',
      name: 'Swift',
      warranty_ends_on: '2022-06-14',
      service_due_on: '2026-08-20',
    })
    expect(rowWhen({ kind: 'thing', id: 't2', thing: car })).toBe('2022-06-14')

    const laptop = thing({
      id: 't3',
      name: 'MacBook',
      warranty_ends_on: '2028-10-08',
      service_due_on: '2026-02-01',
    })
    expect(rowWhen({ kind: 'thing', id: 't3', thing: laptop })).toBe('2026-02-01')
  })

  it('dates neither kind when it carries no date at all', () => {
    expect(
      rowWhen({
        kind: 'document',
        id: 'd2',
        document: document({ id: 'd2', title: 'Marriage certificate' }),
      }),
    ).toBeNull()
    expect(
      rowWhen({ kind: 'thing', id: 't4', thing: thing({ id: 't4', name: 'Sofa' }) }),
    ).toBeNull()
  })
})

describe('the merged order', () => {
  it('interleaves documents and things by date rather than grouping by kind', () => {
    // The whole claim of the All scope. If this ever groups, the merge has silently become two lists
    // stacked — which is the shape ADR-0032 exists to replace, one scroll further down.
    const rows = mergeRows(
      [
        document({ id: 'd1', title: 'Passport', expires_on: '2026-09-12' }),
        document({ id: 'd2', title: 'Car insurance', expires_on: '2026-07-29' }),
      ],
      [
        thing({ id: 't1', name: 'Geyser', service_due_on: '2026-09-14' }),
        thing({ id: 't2', name: 'Swift', service_due_on: '2026-08-20' }),
      ],
    )

    expect(order(rows)).toEqual(['Car insurance', 'Swift', 'Passport', 'Geyser'])
  })

  /**
   * The bug the obvious implementation ships: substituting `''` or `0` for "no date" sorts every
   * undated record to the TOP, so a marriage certificate and a sofa head a list ordered by urgency.
   * A non-trivial count on each side, per D33's rule — with one undated row this passes by accident.
   */
  it('puts undated records last, never first', () => {
    const rows = mergeRows(
      [
        document({ id: 'd1', title: 'Marriage certificate' }),
        document({ id: 'd2', title: 'Passport', expires_on: '2026-09-12' }),
      ],
      [
        thing({ id: 't1', name: 'Sofa' }),
        thing({ id: 't2', name: 'Swift', service_due_on: '2026-08-20' }),
      ],
    )

    expect(order(rows)).toEqual(['Swift', 'Passport', 'Marriage certificate', 'Sofa'])
  })

  /**
   * Without a tie-break, rows sharing a date order by which array they arrived in — so the list
   * reshuffles between renders as the two queries resolve in different orders. A policy and the thing
   * it covers, filed the same day, is the common case rather than a contrived one.
   */
  it('breaks a tie by name, so the list cannot reshuffle between renders', () => {
    /*
      `mergeRows` concatenates documents before things, and `Array.sort` is stable — so with no
      tie-break the document would win every tie by arrival order alone. Naming the *thing* "Apple TV"
      and the *document* "Zebra crossing permit" is what makes this assertion able to fail: it can only
      pass if the name is genuinely being compared.
    */
    const rows = mergeRows(
      [document({ id: 'd1', title: 'Zebra crossing permit', expires_on: '2026-08-01' })],
      [thing({ id: 't1', name: 'Apple TV', warranty_ends_on: '2026-08-01' })],
    )

    expect(order(rows)).toEqual(['Apple TV', 'Zebra crossing permit'])
  })

  it('keeps each row addressable by kind and id, so the list can render two components', () => {
    const rows = mergeRows(
      [document({ id: 'd1', title: 'Passport', expires_on: '2026-09-12' })],
      [thing({ id: 't1', name: 'Swift', service_due_on: '2026-08-20' })],
    )

    expect(rows.map((row) => [row.kind, row.id])).toEqual([
      ['thing', 't1'],
      ['document', 'd1'],
    ])
  })

  it('is empty for two empty collections, rather than throwing', () => {
    expect(mergeRows([], [])).toEqual([])
  })
})
