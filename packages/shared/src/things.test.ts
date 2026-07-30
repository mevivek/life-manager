import { describe, expect, it } from 'vitest'
import {
  CAPTURE_KINDS,
  COVER_ENDING_DAYS,
  KIND_LABELS,
  SERIAL_LABELS,
  SERVICE_DUE_DAYS,
  thingCreateSchema,
  thingKindSchema,
  thingListQuerySchema,
  thingUpdateSchema,
  truncateSerialToLast4,
} from './things.js'

/**
 * Contract tests for Things. These guard the rules a later session is most likely to "simplify"
 * away, and every one of them is a decision recorded in an ADR rather than a validation preference:
 *
 *  - **name-only capture** (Q2 applied to a second domain, ADR-0030)
 *  - **strict query objects** (debt D27)
 *  - **`ownership` is not settable at capture** — a thing is created `here`
 *  - **cover's threshold is its own**, and is not the expiry ladder's (ADR-0029)
 */

describe('thingCreateSchema', () => {
  it('accepts a name and nothing else — Q2, business rule 1', () => {
    const result = thingCreateSchema.safeParse({ name: 'MacBook Air M3' })

    expect(result.success).toBe(true)
    // The default is part of the contract: a thing with nothing but a name is a valid thing, and
    // `other` is what an unanswered kind step leaves behind.
    expect(result.data).toMatchObject({ name: 'MacBook Air M3', kind: 'other' })
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(thingCreateSchema.safeParse({ name: '' }).success).toBe(false)
    expect(thingCreateSchema.safeParse({ name: '   ' }).success).toBe(false)
  })

  it('trims the name rather than storing the padding', () => {
    expect(thingCreateSchema.parse({ name: '  Bosch dishwasher  ' }).name).toBe('Bosch dishwasher')
  })

  it('rejects an unknown field instead of silently dropping it', () => {
    // A renamed or typo'd field must not look like it saved.
    const result = thingCreateSchema.safeParse({ name: 'Golf', warranty: '2028-10-08' })
    expect(result.success).toBe(false)
  })

  it('has no field for ownership — a thing is created here, never already given away', () => {
    // Not a missing feature. Offering a three-way ownership choice at capture would put a decision
    // most things never need onto the fast path; it moves through PATCH from the detail screen.
    for (const field of ['ownership', 'ownership_who', 'ownership_since']) {
      expect(thingCreateSchema.safeParse({ name: 'Golf', [field]: 'lent' }).success).toBe(false)
    }
  })

  it('has no field through which a client could supply a serial mask', () => {
    // `serial_last4` is DERIVED server-side (business rule 7). A client that could send it could
    // send a mask that disagrees with its own number.
    expect(thingCreateSchema.safeParse({ name: 'Golf', serial_last4: '9999' }).success).toBe(false)
  })

  it('keeps money as a decimal string, never a JSON number', () => {
    // conventions/data.md §4 — a JSON number is a float64 and would throw away the precision the
    // `numeric` column exists to keep.
    expect(thingCreateSchema.safeParse({ name: 'Golf', price: 1149 }).success).toBe(false)
    expect(thingCreateSchema.safeParse({ name: 'Golf', price: '1149.00' }).success).toBe(true)
  })
})

describe('thingUpdateSchema', () => {
  it('requires the version precondition — ADR-0024', () => {
    // A forgotten precondition must be a type error and a validation failure, not silent
    // last-write-wins.
    expect(thingUpdateSchema.safeParse({ name: 'Renamed' }).success).toBe(false)
    expect(thingUpdateSchema.safeParse({ version: 2, name: 'Renamed' }).success).toBe(true)
  })

  it('rejects a patch that only carries the version', () => {
    expect(thingUpdateSchema.safeParse({ version: 2 }).success).toBe(false)
  })

  it('distinguishes clearing a field from leaving it alone', () => {
    // An explicit null clears; an absent key means "don't change" (conventions/api.md §8).
    const cleared = thingUpdateSchema.parse({ version: 1, warranty_ends_on: null })
    expect(cleared).toHaveProperty('warranty_ends_on', null)

    const untouched = thingUpdateSchema.parse({ version: 1, name: 'Golf' })
    expect(untouched).not.toHaveProperty('warranty_ends_on')
  })

  it('accepts the ownership triple, which capture does not', () => {
    const result = thingUpdateSchema.safeParse({
      version: 3,
      ownership: 'lent',
      ownership_who: 'Priya',
      ownership_since: '2026-07-30',
    })
    expect(result.success).toBe(true)
  })
})

describe('thingListQuerySchema', () => {
  it('rejects an unknown filter rather than reading the whole table — debt D27', () => {
    expect(thingListQuerySchema.safeParse({ kin: 'vehicle' }).success).toBe(false)
  })

  it('sorts by name by default, not by a date', () => {
    // A thing has no single date that orders it the way an expiry orders a document — cover, service
    // and purchase all compete — so alphabetical is the one order a person can predict.
    expect(thingListQuerySchema.parse({})).toMatchObject({ sort: 'name', order: 'asc' })
  })

  it('normalises a single kind to an array so the repository never branches on arity', () => {
    expect(thingListQuerySchema.parse({ kind: 'vehicle' }).kind).toEqual(['vehicle'])
    expect(thingListQuerySchema.parse({ kind: ['vehicle', 'tool'] }).kind).toEqual([
      'vehicle',
      'tool',
    ])
  })

  it('takes ownership as a set but a holder as one answer', () => {
    // "Show me what is here or lent" is a real question; "whose" is one answer at a time, which is
    // what the design's single chip draws.
    expect(thingListQuerySchema.parse({ ownership: ['here', 'lent'] }).ownership).toEqual([
      'here',
      'lent',
    ])
    expect(thingListQuerySchema.parse({ holder: 'Priya' }).holder).toBe('Priya')
  })
})

describe('the kind taxonomy', () => {
  it('labels every kind, so no enum value can reach a screen unworded', () => {
    for (const kind of thingKindSchema.options) {
      expect(KIND_LABELS[kind]).toBeTruthy()
      expect(SERIAL_LABELS[kind]).toBeTruthy()
    }
  })

  it('offers every kind at capture except `other`', () => {
    // `other` exists so nothing is unfileable and is withheld from the chips so it is never CHOSEN —
    // the same shape as `doc_type: 'other'`. This asserts both halves.
    expect(CAPTURE_KINDS).not.toContain('other')
    expect([...CAPTURE_KINDS].sort()).toEqual(
      thingKindSchema.options.filter((kind) => kind !== 'other').sort(),
    )
  })

  it('names a vehicle registration and a valuable hallmark rather than calling both a serial', () => {
    // Business rule 8. The label is always visible, because an unlabelled twelve-character string is
    // a string nobody can identify.
    expect(SERIAL_LABELS.vehicle).toBe('Registration')
    expect(SERIAL_LABELS.valuable).toBe('Hallmark')
    expect(SERIAL_LABELS.phone).toBe('IMEI')
    expect(SERIAL_LABELS.furniture).toBe('Order number')
  })
})

describe('the cover and service thresholds', () => {
  it('gives cover its own boundary, longer than a document expiry', () => {
    /*
      ADR-0029 and things.md §4 rule 2. This looks like drift and is not: registering a warranty,
      claiming on it or deciding whether to extend has a longer lead than renewing a passport. The
      assertion is here so that "tidying" the two into one constant fails a test rather than quietly
      changing what an ending warranty looks like.
    */
    expect(COVER_ENDING_DAYS).toBe(60)
    expect(SERVICE_DUE_DAYS).toBe(45)
    expect(COVER_ENDING_DAYS).toBeGreaterThan(SERVICE_DUE_DAYS)
  })
})

describe('truncateSerialToLast4', () => {
  it('masks to the last four characters', () => {
    expect(truncateSerialToLast4('C02XL0RTJGH7')).toBe('JGH7')
    expect(truncateSerialToLast4('916')).toBe('916')
    expect(truncateSerialToLast4('')).toBe('')
  })
})
