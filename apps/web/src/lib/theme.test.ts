import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  readPreference,
  resolveTheme,
  storePreference,
  THEME_STORAGE_KEY,
} from './theme'

/**
 * Theme resolution. ADR-0025 §2.
 *
 * Worth testing rather than eyeballing, because the failure modes are all silent: a preference that
 * does not round-trip means the app forgets the user's choice on every launch, and a resolution that
 * disagrees with the inline bootstrap in `index.html` produces a one-frame flash — neither of which
 * throws, and neither of which a screenshot at rest would show.
 */

/** jsdom has no `matchMedia`. Every test that touches system preference installs its own. */
function stubSystem(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: prefersDark && query.includes('dark'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readPreference', () => {
  it('defaults to following the system when nothing has been chosen', () => {
    expect(readPreference()).toBe('system')
  })

  it('reads back an explicit choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readPreference()).toBe('dark')
  })

  it('treats a value it does not recognise as "system" rather than throwing', () => {
    // The key is user-writable via devtools, and a stored `"midnight"` must not break the render of
    // every screen in the app.
    localStorage.setItem(THEME_STORAGE_KEY, 'midnight')
    expect(readPreference()).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('follows the OS when the preference is "system"', () => {
    stubSystem(true)
    expect(resolveTheme('system')).toBe('dark')

    stubSystem(false)
    expect(resolveTheme('system')).toBe('light')
  })

  it('lets an explicit preference win over the OS', () => {
    // A sunset that flips the phone to dark must not override a user who chose light.
    stubSystem(true)
    expect(resolveTheme('light')).toBe('light')

    stubSystem(false)
    expect(resolveTheme('dark')).toBe('dark')
  })
})

describe('storePreference', () => {
  it('round-trips an explicit choice', () => {
    storePreference('dark')
    expect(readPreference()).toBe('dark')
  })

  it('REMOVES the key for "system" rather than storing the word', () => {
    // Storing `"system"` would work, but removing the key is what keeps a stale value from outliving
    // the meaning of the choice — and the inline bootstrap in index.html only checks for the two
    // explicit values, so a stored `"system"` there falls through to the media query anyway. Same
    // behaviour from both copies of the logic.
    storePreference('dark')
    storePreference('system')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(readPreference()).toBe('system')
  })
})

describe('applyTheme', () => {
  it('stamps the resolved theme on <html>, which is the only thing the CSS reads', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    applyTheme('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('moves the theme-color meta tag with it, so the OS status bar matches', () => {
    const meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    meta.setAttribute('content', '#f7f5f0')
    document.head.append(meta)

    applyTheme('dark')
    // Left at one hardcoded value this is wrong in one theme by definition, and on iOS that shows as
    // a mismatched strip above a standalone PWA.
    expect(meta.getAttribute('content')).toBe('#131311')

    applyTheme('light')
    expect(meta.getAttribute('content')).toBe('#f7f5f0')

    meta.remove()
  })

  it('does not throw when there is no theme-color tag to move', () => {
    // Tests render without index.html, so the tag genuinely is absent here — and a missing meta tag
    // must not take the whole app down on mount.
    expect(() => applyTheme('dark')).not.toThrow()
  })
})
