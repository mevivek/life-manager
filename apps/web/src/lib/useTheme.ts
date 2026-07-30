import { useCallback, useEffect, useState } from 'react'
import {
  applyTheme,
  type ResolvedTheme,
  readPreference,
  resolveTheme,
  storePreference,
  type ThemePreference,
  watchSystemTheme,
} from './theme'

/**
 * The theme, as a hook. `lib/theme.ts` holds the DOM-and-storage half; this is the React half.
 *
 * Returns the stored *preference* as well as the *resolved* theme, because a control that only
 * knows "dark" cannot offer "follow the system" — and following the system is the right default for
 * an app whose whole point is that you open it twice a month.
 */
export function useTheme(): {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (next: ThemePreference) => void
  toggle: () => void
} {
  /**
   * Initialised from storage rather than from a constant, so the first render already agrees with
   * whatever the pre-paint bootstrap in `index.html` put on `<html>`. Seeding this with `'system'`
   * would make the first paint disagree with the DOM for one frame.
   */
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(readPreference()))

  useEffect(() => {
    const next = resolveTheme(preference)
    setResolved(next)
    applyTheme(next)

    // Only track the OS while the user has not made a choice. With an explicit preference, a
    // sunset that flips the phone to dark must not silently override it.
    if (preference !== 'system') return
    return watchSystemTheme((systemResolved) => {
      setResolved(systemResolved)
      applyTheme(systemResolved)
    })
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    storePreference(next)
    setPreferenceState(next)
  }, [])

  /**
   * Toggle goes to the *opposite of what is on screen*, and lands on an explicit light/dark rather
   * than cycling back through `system`. A three-way cycle on a single control means the user taps
   * once, sees nothing change (because `system` already resolved to what they were looking at), and
   * concludes the button is broken.
   */
  const toggle = useCallback(() => {
    setPreference(resolveTheme(readPreference()) === 'dark' ? 'light' : 'dark')
  }, [setPreference])

  return { preference, resolved, setPreference, toggle }
}
