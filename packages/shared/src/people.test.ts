import { describe, expect, it } from 'vitest'
import { MAX_RELATION_LENGTH, personSchema, RELATION_SUGGESTIONS } from './people.js'

/**
 * The relation suggestions, and the two properties of the list that are **not** self-evident from
 * reading it.
 *
 * Not tested here: that any particular relation is present. `RelationField.test.tsx` walks this
 * array and asserts every entry renders as a chip, so adding one is already covered — an assertion
 * that `'Cousin'` is in the array it was just added to would only restate the edit.
 */

describe('RELATION_SUGGESTIONS', () => {
  it('keeps the catch-all last, because this array is the render order', () => {
    // `Household` is the only entry that is not a person, and it is drawn in the same row as the
    // people. Appending is the natural way to add a relation, and appending is exactly what would
    // silently push it out of last place — so the one ordering rule the list has gets an assertion
    // rather than only a comment.
    expect(RELATION_SUGGESTIONS.at(-1)).toBe('Household')
    expect(RELATION_SUGGESTIONS.filter((relation) => relation === 'Household')).toHaveLength(1)
  })

  it('offers no duplicates, which would render as two identical chips', () => {
    expect(new Set(RELATION_SUGGESTIONS).size).toBe(RELATION_SUGGESTIONS.length)
    // A non-zero count, and one that moves when the list does (D33) — a `Set` of an empty array
    // also has no duplicates.
    expect(RELATION_SUGGESTIONS.length).toBeGreaterThan(1)
  })

  it('every suggestion is a value the wire will actually accept', () => {
    /*
      The list is *suggestions, never an enum*, so nothing forces the two to agree — a chip longer
      than `MAX_RELATION_LENGTH` would be offered by the app and then rejected by its own server,
      which is the worst shape a validation bug can take. Cheap to prove, so proven.
    */
    for (const relation of RELATION_SUGGESTIONS) {
      expect(relation.length, `"${relation}" is longer than the column allows`).toBeLessThanOrEqual(
        MAX_RELATION_LENGTH,
      )
      const parsed = personSchema.shape.relation.safeParse(relation)
      expect(parsed.success, `"${relation}" is not a valid relation`).toBe(true)
    }
  })
})
