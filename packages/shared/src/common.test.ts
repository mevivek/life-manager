import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PROBLEM_BASE_URI,
  pageQuerySchema,
  paginated,
  problemSchema,
} from './common.js'

describe('paginated()', () => {
  const schema = paginated(z.object({ id: z.uuid() }))

  it('accepts a page with a null next_cursor', () => {
    const result = schema.safeParse({
      data: [{ id: '11111111-1111-4111-8111-111111111111' }],
      next_cursor: null,
    })

    expect(result.success).toBe(true)
  })

  it('rejects a page that omits next_cursor, so "last page" is always explicit', () => {
    const result = schema.safeParse({ data: [] })

    expect(result.success).toBe(false)
  })
})

describe('pageQuerySchema', () => {
  it('defaults limit and leaves cursor absent', () => {
    const result = pageQuerySchema.parse({})

    expect(result.limit).toBe(DEFAULT_PAGE_LIMIT)
    expect(result.cursor).toBeUndefined()
  })

  it('rejects a limit above the maximum rather than clamping it', () => {
    const result = pageQuerySchema.safeParse({ limit: MAX_PAGE_LIMIT + 1 })

    expect(result.success).toBe(false)
  })
})

describe('problemSchema', () => {
  it('round-trips the RFC 9457 example from conventions/api.md §3', () => {
    const problem = {
      type: `${PROBLEM_BASE_URI}/validation-failed`,
      title: 'Validation failed',
      status: 400,
      detail: 'expires_on must be a valid ISO date',
      instance: '/api/v1/documents',
      errors: [{ path: 'expires_on', message: 'Invalid date' }],
    }

    expect(problemSchema.parse(problem)).toEqual(problem)
  })

  it('rejects a status outside the error range, so a 200 can never be a problem', () => {
    const result = problemSchema.safeParse({
      type: `${PROBLEM_BASE_URI}/nope`,
      title: 'Nope',
      status: 200,
      detail: 'not an error',
    })

    expect(result.success).toBe(false)
  })
})
