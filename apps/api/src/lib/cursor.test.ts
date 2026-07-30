import { describe, expect, it } from 'vitest'
import { cursorSortKind as documentSortKind } from '../domains/documents/documents.repository.js'
import { cursorSortKind as thingSortKind } from '../domains/things/things.repository.js'
import { type CursorSortKind, decodeCursor, encodeCursor } from './cursor.js'
import { BadRequestError } from './errors.js'

/**
 * Cursor validation, with **no database** — deliberately, like the maintenance endpoint's
 * constant-time tests. Everything here is pure, so it runs in a container with no Postgres, where
 * the integration coverage in `documents.test.ts` / `things.test.ts` skips.
 *
 * What it exists to pin: a cursor a client did not get from us is rejected as a **400 before any SQL
 * is built**. Until 2026-07-30 a *well-formed* cursor carrying `i: "not-a-uuid"` was bound straight
 * into the `WHERE` clause and Postgres raised `22P02`, which reached the caller as a 500 on every
 * paginated endpoint. Not a cross-space read — the tenant filter is a separate `AND` — but a
 * guaranteed outage for anyone able to send a query string.
 */

const ID = '3f1a9b5e-7c2d-4e8a-9b0f-1d2c3e4f5a6b'

const base64 = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

/** Asserts the rejection is the client-facing 400, not a thrown 500 and not a silent page one. */
function expectRejected(raw: string, kind: CursorSortKind): void {
  let thrown: unknown
  try {
    decodeCursor(raw, kind)
  } catch (error) {
    thrown = error
  }

  expect(thrown, `cursor should have been rejected: ${raw}`).toBeInstanceOf(BadRequestError)
  if (!(thrown instanceof BadRequestError)) return
  expect(thrown.status).toBe(400)
  // The message must not echo the payload back: it would publish the internal field letters.
  expect(thrown.message).toBe('That pagination cursor is not valid.')
}

describe('the sort-value kind derived from each sort column', () => {
  it('covers every sort option both domains expose, and follows the column type', () => {
    // Read off the Drizzle column, so this fails rather than guessing if a column changes type.
    expect(documentSortKind('expires_on')).toBe('date')
    expect(documentSortKind('title')).toBe('text')
    // `created_at` is a timestamptz, NOT a date — the distinction the 45-day-looking `date` columns
    // hide, and the one that made a legitimate `?sort=created_at` cursor a 500.
    expect(documentSortKind('created_at')).toBe('timestamp')

    expect(thingSortKind('name')).toBe('text')
    for (const sort of ['purchased_on', 'warranty_ends_on', 'service_due_on'] as const) {
      expect(thingSortKind(sort), sort).toBe('date')
    }
  })
})

describe('decodeCursor', () => {
  it('round-trips a cursor this file minted, for each kind', () => {
    expect(decodeCursor(encodeCursor({ sortValue: 'Dishwasher', id: ID }), 'text')).toEqual({
      sortValue: 'Dishwasher',
      id: ID,
    })
    expect(decodeCursor(encodeCursor({ sortValue: '2026-01-31', id: ID }), 'date')).toEqual({
      sortValue: '2026-01-31',
      id: ID,
    })
    const instant = new Date('2026-07-30T19:28:57.668Z').toISOString()
    expect(decodeCursor(encodeCursor({ sortValue: instant, id: ID }), 'timestamp')).toEqual({
      sortValue: instant,
      id: ID,
    })
  })

  it('accepts a null sort value for every kind — nulls sort last and still need a page two', () => {
    for (const kind of ['text', 'date', 'timestamp'] as const) {
      expect(decodeCursor(encodeCursor({ sortValue: null, id: ID }), kind)).toEqual({
        sortValue: null,
        id: ID,
      })
    }
  })

  it('rejects a well-formed cursor whose id is not a uuid — the 500 this file exists to stop', () => {
    expectRejected(base64({ v: 1, s: null, i: 'not-a-uuid' }), 'text')
    expectRejected(base64({ v: 1, s: 'Dishwasher', i: '' }), 'text')
    expectRejected(base64({ v: 1, s: null, i: 42 }), 'text')
    expectRejected(base64({ v: 1, s: null }), 'text')
  })

  it('rejects a sort value of the wrong type for the column it will be compared against', () => {
    expectRejected(base64({ v: 1, s: 'nope', i: ID }), 'date')
    // Right idea, wrong precision: a calendar date is not an instant and vice versa.
    expectRejected(base64({ v: 1, s: '2026-07-30', i: ID }), 'timestamp')
    expectRejected(base64({ v: 1, s: '2026-07-30T19:28:57.668Z', i: ID }), 'date')
    expectRejected(base64({ v: 1, s: '2026-13-45', i: ID }), 'date')
    expectRejected(base64({ v: 1, s: 12, i: ID }), 'date')
  })

  it('accepts any string for a text column, because any string is a legitimate name', () => {
    for (const value of ['nope', '2026-13-45', "'; drop table things --", '🙂']) {
      expect(decodeCursor(base64({ v: 1, s: value, i: ID }), 'text')).toEqual({
        sortValue: value,
        id: ID,
      })
    }
  })

  it('rejects a wrong version, an extra key, and something that is not base64 at all', () => {
    expectRejected(base64({ v: 2, s: null, i: ID }), 'text')
    // An unrecognised key means it did not come from `encodeCursor`.
    expectRejected(base64({ v: 1, s: null, i: ID, extra: 'x' }), 'text')
    expectRejected('not-a-real-cursor', 'text')
    expectRejected(base64('a bare string'), 'text')
    expectRejected(base64(null), 'text')
    expectRejected(base64([1, 2, 3]), 'text')
  })
})
