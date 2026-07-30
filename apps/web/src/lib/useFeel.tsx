import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { applyFeel, DEFAULT_FEEL, type Feel, readFeel, storeFeel } from './feel'
import { copyFor, type VoiceCopy } from './voice'

/**
 * The feel preferences, as React. `lib/feel.ts` holds the DOM-and-storage half.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A context, where the theme gets away with a plain hook — and why the difference is real
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `useTheme` can be a bare hook because the theme's only consumer *of the value* is the control that
 * sets it: everything else reads the DOM attribute through CSS. Density and face are the same. **Voice
 * is not.** Nine sentences across five components read it as a value, and two independent `useState`s
 * seeded from `localStorage` are two sources of truth that agree only until one of them is set.
 *
 * The concrete failure that shape produces: the Feel card lives on You, and the sentences it changes
 * live on Now. Whether a bare hook appeared to work would depend entirely on whether TanStack Router
 * happened to keep the Now screen mounted across a tab switch — which is a routing implementation
 * detail, not a decision anyone made about this feature. A context makes the answer the same either
 * way.
 *
 * `copy` is memoised on `voice` alone, so a density change does not hand every consumer a new object
 * and re-render the prose for nothing.
 */

type FeelContextValue = {
  feel: Feel
  /** Sets one preference. Per-key rather than whole-object, because the three are independent. */
  set: <K extends keyof Feel>(key: K, value: Feel[K]) => void
  copy: VoiceCopy
}

const FeelContext = createContext<FeelContextValue | null>(null)

export function FeelProvider({ children }: { children: React.ReactNode }) {
  /**
   * Seeded from storage, not from `DEFAULT_FEEL`, so the first render agrees with what the pre-paint
   * bootstrap in `index.html` already stamped on `<html>`. Seeding with the default would make one
   * frame of a compact user's app render generous.
   */
  const [feel, setFeel] = useState<Feel>(readFeel)

  // Re-stamped on every change, and once on mount — the mount pass is what makes the bootstrap
  // optional rather than required, so a missing inline script degrades to a flash rather than to a
  // preference that silently does nothing.
  useEffect(() => {
    applyFeel(feel)
  }, [feel])

  const set = useCallback(<K extends keyof Feel>(key: K, value: Feel[K]) => {
    storeFeel(key, value)
    setFeel((previous) => ({ ...previous, [key]: value }))
  }, [])

  const copy = useMemo(() => copyFor(feel.voice), [feel.voice])
  const value = useMemo<FeelContextValue>(() => ({ feel, set, copy }), [feel, set, copy])

  return <FeelContext.Provider value={value}>{children}</FeelContext.Provider>
}

/**
 * Falls back to the defaults outside a provider rather than throwing.
 *
 * Deliberate, and the reason is testing: a dozen component tests render a single component with no
 * app shell around it, and making every one of them wrap a provider to read one sentence would be a
 * tax paid forever to catch a mistake that shows up on the first render in a browser anyway. The
 * fallback is the *design's* default, so a component outside a provider looks exactly like the app
 * does for a user who never touched the setting.
 */
export function useFeel(): FeelContextValue {
  const context = useContext(FeelContext)
  if (context !== null) return context
  return { feel: DEFAULT_FEEL, set: () => {}, copy: copyFor(DEFAULT_FEEL.voice) }
}
