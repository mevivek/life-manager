import { describe, expect, it } from 'vitest'
import {
  documentCreateSchema,
  documentListQuerySchema,
  documentUpdateSchema,
  presignUploadRequestSchema,
  truncateToLast4,
  validateCustomAttrs,
} from './documents.js'

/**
 * Contract tests. These guard the two rules most likely to be "simplified" away by a later
 * session, both of which are load-bearing:
 *
 *  - **strict query objects** (debt D27) — the reason unknown filters fail loudly
 *  - **title-only capture** (Q2) — a product decision, not a validation oversight
 */

describe('documentCreateSchema', () => {
  it('accepts a title and nothing else — Q2, business rule 1', () => {
    const result = documentCreateSchema.safeParse({ title: 'Passport' })

    expect(result.success).toBe(true)
    // The defaults are part of the contract: a half-empty document is a valid document.
    expect(result.data).toMatchObject({ title: 'Passport', doc_type: 'other', tags: [] })
  })

  it('rejects an empty or whitespace-only title', () => {
    expect(documentCreateSchema.safeParse({ title: '' }).success).toBe(false)
    expect(documentCreateSchema.safeParse({ title: '   ' }).success).toBe(false)
  })

  it('trims the title rather than storing the padding', () => {
    const result = documentCreateSchema.parse({ title: '  Passport  ' })
    expect(result.title).toBe('Passport')
  })

  it('rejects an unknown field instead of silently dropping it', () => {
    // A typo'd or renamed field must not look like it saved. This is the create-side twin of
    // D27's list-side rule.
    const result = documentCreateSchema.safeParse({ title: 'Passport', expiry: '2030-01-01' })
    expect(result.success).toBe(false)
  })

  it('has no field through which a client could supply a storage key', () => {
    // Invariant 6 / business rule 5, enforced structurally: strictObject means there is
    // nowhere for it to land.
    for (const field of ['storage_key', 'storageKey', 'path', 'filename', 'key']) {
      const result = documentCreateSchema.safeParse({ title: 'Passport', [field]: 'anything' })
      expect(result.success, `${field} must be rejected`).toBe(false)
    }
  })
})

describe('documentUpdateSchema', () => {
  it('distinguishes an absent key from an explicit null — conventions/api.md §8', () => {
    const cleared = documentUpdateSchema.parse({ issuer: null })
    expect('issuer' in cleared).toBe(true)
    expect(cleared.issuer).toBeNull()

    const untouched = documentUpdateSchema.parse({ title: 'Renamed' })
    expect('issuer' in untouched).toBe(false)
  })

  it('rejects an empty patch', () => {
    expect(documentUpdateSchema.safeParse({}).success).toBe(false)
  })
})

describe('documentListQuerySchema', () => {
  it('rejects an unknown query parameter — debt D27, the whole reason this is strict', () => {
    // The real-world case: a typo in a filter name must not return the UNFILTERED list.
    const result = documentListQuerySchema.safeParse({ expiring_befor: '2026-12-31' })
    expect(result.success).toBe(false)
  })

  it('defaults to expiring-soonest first, not newest first — §5', () => {
    const result = documentListQuerySchema.parse({})
    expect(result.sort).toBe('expires_on')
    expect(result.order).toBe('asc')
    expect(result.limit).toBe(50)
  })

  it('normalises a repeatable parameter to an array whether given once or many times', () => {
    expect(documentListQuerySchema.parse({ type: 'identity' }).type).toEqual(['identity'])
    expect(documentListQuerySchema.parse({ type: ['identity', 'legal'] }).type).toEqual([
      'identity',
      'legal',
    ])
  })

  it('coerces limit from a querystring and enforces the maximum', () => {
    expect(documentListQuerySchema.parse({ limit: '10' }).limit).toBe(10)
    expect(documentListQuerySchema.safeParse({ limit: '500' }).success).toBe(false)
  })

  it('parses has_file as a boolean from the string a querystring actually carries', () => {
    expect(documentListQuerySchema.parse({ has_file: 'true' }).has_file).toBe(true)
    expect(documentListQuerySchema.parse({ has_file: 'false' }).has_file).toBe(false)
  })
})

describe('truncateToLast4 — business rule 6', () => {
  it('keeps only the last four characters', () => {
    expect(truncateToLast4('X1234567')).toBe('4567')
  })

  it('leaves a value already short enough alone', () => {
    expect(truncateToLast4('12')).toBe('12')
  })
})

describe('validateCustomAttrs', () => {
  it('accepts the keys its doc_type declares', () => {
    const result = validateCustomAttrs('warranty', { vendor: 'Acme', coverage_months: 24 })
    expect(result.ok).toBe(true)
  })

  it('rejects a key belonging to a different doc_type', () => {
    // `nationality` is an identity key. Silently keeping it would let JSONB accumulate
    // fields no schema describes, which is the failure conventions/data.md §5 exists to stop.
    const result = validateCustomAttrs('warranty', { nationality: 'GB' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.issues[0]?.path).toContain('custom_attrs')
  })

  it('requires money to be a decimal string, not a float', () => {
    // A JSON number is a float64; numeric(19,4) exists precisely to avoid that.
    expect(validateCustomAttrs('receipt', { amount: 12.34 }).ok).toBe(false)
    expect(validateCustomAttrs('receipt', { amount: '12.34' }).ok).toBe(true)
  })

  it('accepts no keys at all for `other`', () => {
    expect(validateCustomAttrs('other', {}).ok).toBe(true)
    expect(validateCustomAttrs('other', { anything: 'x' }).ok).toBe(false)
  })
})

describe('presignUploadRequestSchema — business rules 5 and 11', () => {
  it('rejects a size over the 25 MB limit before any bytes move', () => {
    expect(
      presignUploadRequestSchema.safeParse({ mime: 'application/pdf', size_bytes: 1 }).success,
    ).toBe(true)
    expect(
      presignUploadRequestSchema.safeParse({
        mime: 'application/pdf',
        size_bytes: 26 * 1024 * 1024,
      }).success,
    ).toBe(false)
  })

  it('rejects a mime type outside the allowlist', () => {
    expect(
      presignUploadRequestSchema.safeParse({ mime: 'application/zip', size_bytes: 100 }).success,
    ).toBe(false)
  })

  it('makes a new upload primary by default — business rule 3', () => {
    const result = presignUploadRequestSchema.parse({ mime: 'image/png', size_bytes: 100 })
    expect(result.make_primary).toBe(true)
  })
})
