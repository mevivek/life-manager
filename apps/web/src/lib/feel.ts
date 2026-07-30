/**
 * **Feel** — the three preferences the third design handoff adds: density, heading face, and voice.
 *
 * They are one module because they share every property that matters: device-scoped, read before
 * first paint, and stored the same way as the theme. `theme.ts` is the sibling to read first; this
 * file is deliberately shaped like it rather than inventing a second pattern.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Applied as `data-*` attributes, NOT as inline custom properties.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The comp does `documentElement.style.setProperty('--gutter', …)`. That is the one thing not to copy.
 * An inline style is the highest-priority declaration there is, so it would beat the `@media
 * (min-width: 430px)` block in `styles.css` that opens the gutter and steps up the display size on a
 * Pro Max — and the app would silently stop being responsive the moment either density was applied,
 * including the default one. `[data-density]` participates in the cascade like everything else.
 *
 * ── Each of the three is a different KIND of thing, and that is why voice is not a token ──
 *
 *  - **density** and **face** are pure token swaps. They change no markup and no words, so they live
 *    entirely in CSS and this module only stamps the attribute. Every headline uses `font-heading`
 *    (not `font-serif`), so the face preference reaches all of them at once — the handoff drives
 *    even document titles and the account email from `--face-h`, so "heading" here means every
 *    serif-weight headline, not only the page `<h1>`s.
 *  - **voice** rewrites *sentences*, which CSS cannot do. It is threaded through `lib/voice.ts` and
 *    read by the handful of components that speak in prose.
 *
 * ── Why localStorage, and not the account ──
 *
 * Same argument as the theme: this is device state. Someone may well want compact on a phone and
 * generous on a laptop, and syncing it would also drag it through the `persister.ts` allowlist for no
 * reason. It is read synchronously before paint, which rules out IndexedDB regardless.
 */

export type Density = 'generous' | 'compact'
export type Face = 'serif' | 'grotesk'
export type Voice = 'warm' | 'plain'

export type Feel = {
  density: Density
  face: Face
  voice: Voice
}

/**
 * The defaults are the design's defaults, and they are also what the app looked like before this
 * existed — so a user who never opens the Feel card sees no change at all.
 */
export const DEFAULT_FEEL: Feel = { density: 'generous', face: 'serif', voice: 'warm' }

/**
 * Shared with the inline bootstrap in `index.html`. **If you rename these, rename them there too** —
 * they are two copies of one contract, and the bootstrap cannot import from this module because it
 * has to run before any bundle is fetched.
 */
export const FEEL_STORAGE_KEYS = {
  density: 'life-manager-density',
  face: 'life-manager-face',
  voice: 'life-manager-voice',
} as const

/**
 * The valid values, per key. Exported because `feel.test.ts` walks them: a fourth option added to any
 * of these without a matching CSS block or voice branch is the failure this shape makes findable.
 */
export const FEEL_OPTIONS = {
  density: ['generous', 'compact'],
  face: ['serif', 'grotesk'],
  voice: ['warm', 'plain'],
} as const satisfies Record<keyof Feel, readonly string[]>

/**
 * A stored value we do not recognise falls back to the default rather than throwing.
 *
 * The same forgiving read as `theme.ts`, for the same reason: a preference is never worth breaking a
 * render over, and a value written by an older build must not be able to white-screen a newer one.
 */
export function readFeel(): Feel {
  return {
    density: readOne('density'),
    face: readOne('face'),
    voice: readOne('voice'),
  }
}

function readOne<K extends keyof Feel>(key: K): Feel[K] {
  try {
    const stored = localStorage.getItem(FEEL_STORAGE_KEYS[key])
    const allowed: readonly string[] = FEEL_OPTIONS[key]
    return stored !== null && allowed.includes(stored) ? (stored as Feel[K]) : DEFAULT_FEEL[key]
  } catch {
    // Safari in private mode throws on `localStorage` access rather than returning null.
    return DEFAULT_FEEL[key]
  }
}

/**
 * Stamps density and face onto `<html>`, which is all the CSS reads.
 *
 * **The default is written as an attribute too, rather than left absent.** Absence would work — the
 * `:root` block holds the generous serif values — but then the bootstrap in `index.html` and this
 * function would disagree about what "unset" looks like, and a `[data-density]` selector in a future
 * stylesheet would silently not match the majority of users. One shape, always present.
 *
 * `voice` is deliberately NOT stamped: nothing in CSS can act on it, and an attribute that no
 * stylesheet reads is a comment pretending to be code.
 */
export function applyFeel(feel: Feel): void {
  document.documentElement.dataset.density = feel.density
  document.documentElement.dataset.face = feel.face
}

export function storeFeel<K extends keyof Feel>(key: K, value: Feel[K]): void {
  try {
    if (value === DEFAULT_FEEL[key]) {
      // Removing rather than writing the default keeps "never chose" and "chose the default"
      // indistinguishable, so a future change of default reaches the people who never expressed a
      // preference — which is the behaviour they would want.
      localStorage.removeItem(FEEL_STORAGE_KEYS[key])
    } else {
      localStorage.setItem(FEEL_STORAGE_KEYS[key], value)
    }
  } catch {
    // As in `theme.ts`: a failed write means the choice does not survive a reload, which is a far
    // better outcome than a thrown error in a click handler.
  }
}
