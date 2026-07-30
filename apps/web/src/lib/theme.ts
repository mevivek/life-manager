/**
 * Light/dark resolution for the Ledger design system (ADR-0025).
 *
 * ── Why the DOM always carries an explicit `data-theme` ──
 *
 * `styles.css` has exactly two token blocks: `:root` (light) and `[data-theme="dark"]`. It has no
 * `prefers-color-scheme` media query, and that is deliberate — covering "the system prefers dark
 * and the user has not chosen" in CSS alone would mean repeating the entire dark palette a second
 * time inside a media query, and a duplicated palette is a palette that drifts.
 *
 * So resolution happens here instead: `system | light | dark` is the stored *preference*, and the
 * resolved `light | dark` is stamped onto `<html>`. The same resolution is inlined in `index.html`
 * so it runs before first paint — see the comment there. Without that inline copy the app would
 * paint light and then flip, which is the single most obvious "this is a web page" tell there is.
 *
 * ── Why localStorage rather than the Query cache ──
 *
 * A theme is device state, not account state: the same person wants dark on the phone at 11pm and
 * light on the laptop at noon. Putting it in TanStack Query would sync it across devices (wrong),
 * and would put it through the `persister.ts` allowlist for no reason. It is also read
 * *synchronously* during the pre-paint bootstrap, which rules out IndexedDB.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

/**
 * Shared with the inline bootstrap in `index.html`. **If you rename this, rename it there too** —
 * they are two copies of one contract, and the bootstrap cannot import from this module because it
 * has to run before any bundle is fetched.
 */
export const THEME_STORAGE_KEY = 'life-manager-theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** A stored value we do not recognise is treated as `system`, not as an error. */
export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
  } catch {
    // Safari in private mode throws on `localStorage` access rather than returning null. A theme
    // is not worth breaking a render over.
    return 'system'
  }
}

export function systemTheme(): ResolvedTheme {
  return typeof matchMedia === 'function' && matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system' ? systemTheme() : preference
}

/** Writes the resolved theme to `<html>`, which is the only thing the CSS reads. */
export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
  /**
   * `theme-color` drives the OS status-bar tint in a standalone PWA. Left at a single hardcoded
   * value it is wrong in one theme by definition — and on iOS that shows up as a mismatched strip
   * above the app, which is exactly the kind of seam the app-shell rules in `styles.css` exist to
   * remove.
   */
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta !== null) {
    meta.setAttribute('content', resolved === 'dark' ? '#131311' : '#f7f5f0')
  }
}

export function storePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') {
      localStorage.removeItem(THEME_STORAGE_KEY)
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, preference)
    }
  } catch {
    // Same as `readPreference`: a failed write means the choice does not survive a reload, which is
    // a far better outcome than a thrown error in a click handler.
  }
}

/**
 * Subscribes to OS theme changes, and returns the unsubscribe.
 *
 * Only meaningful while the preference is `system` — the caller checks that, because this function
 * has no business reading storage on every media change.
 */
export function watchSystemTheme(onChange: (theme: ResolvedTheme) => void): () => void {
  if (typeof matchMedia !== 'function') return () => {}
  const query = matchMedia(DARK_QUERY)
  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? 'dark' : 'light')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
