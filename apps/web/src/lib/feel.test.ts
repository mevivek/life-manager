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
    expect(readFeel()).toEqual({ density: 'compact', face: 'grotesk', voice: 'plain' })
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
    applyFeel({ density: 'compact', face: 'grotesk', voice: 'plain' })
    expect(document.documentElement.dataset.density).toBe('compact')
    expect(document.documentElement.dataset.face).toBe('grotesk')
  })

  it('never stamps voice — no stylesheet reads it, and an attribute nothing matches is a lie', () => {
    applyFeel({ density: 'generous', face: 'serif', voice: 'plain' })
    // The reason voice is threaded through React instead: CSS cannot rewrite a sentence.
    expect(document.documentElement.dataset.voice).toBeUndefined()
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
