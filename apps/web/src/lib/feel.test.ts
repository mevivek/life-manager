import { afterEach, describe, expect, it } from 'vitest'
import {
  applyFeel,
  DEFAULT_FEEL,
  FEEL_OPTIONS,
  FEEL_STORAGE_KEYS,
  readFeel,
  storeFeel,
} from './feel'

/**
 * The storage-and-DOM half of the feel preferences. Same forgiving contract as `theme.ts`: an
 * unreadable or unrecognised value falls back to the design's default rather than throwing, because a
 * preference written by an older build must never be able to white-screen a newer one.
 */

afterEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.density
  delete document.documentElement.dataset.face
})

describe('readFeel', () => {
  it('returns the design defaults when nothing is stored', () => {
    expect(readFeel()).toEqual(DEFAULT_FEEL)
  })

  it('reads back each stored preference', () => {
    localStorage.setItem(FEEL_STORAGE_KEYS.density, 'compact')
    localStorage.setItem(FEEL_STORAGE_KEYS.face, 'grotesk')
    localStorage.setItem(FEEL_STORAGE_KEYS.voice, 'plain')
    localStorage.setItem(FEEL_STORAGE_KEYS.numbers, 'hidden')
    expect(readFeel()).toEqual({
      density: 'compact',
      face: 'grotesk',
      voice: 'plain',
      numbers: 'hidden',
    })
  })

  it('shows numbers unless the device has asked otherwise — ADR-0034', () => {
    /**
     * The default is the decision, so it is asserted rather than left to the object comparison above.
     * Masking was unconditional before ADR-0034; `shown` is what makes the archive answer "what is my
     * Aadhaar number" without a tap, and a session that flips this default back has reversed an ADR
     * rather than changed a constant.
     */
    expect(readFeel().numbers).toBe('shown')

    localStorage.setItem(FEEL_STORAGE_KEYS.numbers, 'hidden')
    expect(readFeel().numbers).toBe('hidden')

    // And a value from a build that spelled it differently falls back rather than masking by accident.
    localStorage.setItem(FEEL_STORAGE_KEYS.numbers, 'masked')
    expect(readFeel().numbers).toBe('shown')
  })

  it('falls back to the default for a value written by an older or broken build', () => {
    // The exact class of bug the forgiving read exists for: a value the current build does not know.
    localStorage.setItem(FEEL_STORAGE_KEYS.density, 'spacious-XL')
    expect(readFeel().density).toBe(DEFAULT_FEEL.density)
  })
})

describe('storeFeel', () => {
  it('removes the key when the value is the default, so “never chose” and “chose default” match', () => {
    localStorage.setItem(FEEL_STORAGE_KEYS.voice, 'plain')
    storeFeel('voice', 'warm') // warm is the default
    // Not stored as "warm" — removed, so a future change of default reaches this user too.
    expect(localStorage.getItem(FEEL_STORAGE_KEYS.voice)).toBeNull()
  })

  it('writes a non-default value', () => {
    storeFeel('density', 'compact')
    expect(localStorage.getItem(FEEL_STORAGE_KEYS.density)).toBe('compact')
  })
})

describe('applyFeel', () => {
  it('stamps density and face onto <html>, including the default', () => {
    applyFeel({ density: 'compact', face: 'grotesk', voice: 'plain', numbers: 'shown' })
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.face).toBe('grotesk')
  })

  it('never stamps voice or numbers — an attribute no stylesheet matches is a lie', () => {
    applyFeel({ density: 'generous', face: 'serif', voice: 'plain', numbers: 'hidden' })
    // Why both are threaded through React instead: CSS cannot rewrite a sentence, and it cannot
    // choose between a value and a mask of it either.
    expect(document.documentElement.dataset.voice).toBeUndefined()
    expect(document.documentElement.dataset.numbers).toBeUndefined()
  })
})

describe('the option lists', () => {
  it('name a default that is itself a valid option', () => {
    // A default outside its own allow-list would be discarded by `readFeel` on every read.
    for (const key of Object.keys(FEEL_OPTIONS) as (keyof typeof FEEL_OPTIONS)[]) {
      expect(FEEL_OPTIONS[key]).toContain(DEFAULT_FEEL[key])
    }
  })
})
