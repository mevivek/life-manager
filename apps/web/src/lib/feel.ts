/**
 * **Feel** — the four device preferences: density, heading face, voice, and whether numbers are
 * hidden. The first three came from the third design handoff; `numbers` is
 * [ADR-0034](../../../../docs/decisions/0034-numbers-shown-by-default.md).
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
 * ── Each of these is a different KIND of thing, and that is why voice is not a token ──
 *
 *  - **density** and **face** are pure token swaps. They change no markup and no words, so they live
 *    entirely in CSS and this module only stamps the attribute. Every headline uses `font-heading`
 *    (not `font-serif`), so the face preference reaches all of them at once — the handoff drives
 *    even document titles and the account email from `--face-h`, so "heading" here means every
 *    serif-weight headline, not only the page `<h1>`s.
 *  - **voice** rewrites *sentences*, which CSS cannot do. It is threaded through `lib/voice.ts` and
 *    read by the handful of components that speak in prose.
 *  - **numbers** is voice-shaped rather than token-shaped: it decides what a component *renders*,
 *    not how the render looks, so `IdentifierCard`, `DocumentRow` and `ThingSerial` read it as a
 *    value through `useFeel`. There is no `[data-numbers]` attribute for the same reason there is no
 *    `[data-voice]` one — an attribute no stylesheet reads is a comment pretending to be code.
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

/**
 * Whether an identifier or a serial is drawn in full or behind `•••• 8109` — ADR-0034.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  `hidden` is a display state and NOT an authorization boundary. It never has been.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0026 stores the value in full and ADR-0027 returns it on every list response, so the number is
 * in the payload before anything is tapped and this preference cannot gate it — invariant: authorization
 * is server-side, and UI gating is not a boundary. What it is good for is **shoulders near the screen**,
 * which is a real cost in a coffee shop and no cost at all at a kitchen table. That is exactly the
 * shape of a preference rather than a default.
 */
export type Numbers = 'shown' | 'hidden'

export type Feel = {
  density: Density
  face: Face
  voice: Voice
  numbers: Numbers
}

/**
 * The defaults are the design's defaults, and for density, face and voice they are also what the app
 * looked like before they existed — so a user who never opens the Feel card sees no change at all.
 *
 * **`numbers` is the exception, deliberately**: masking used to be unconditional, and ADR-0034 makes
 * `shown` the default because the archive is where you go when you need a number and a reveal tap
 * bought nothing that the payload had not already given away.
 */
export const DEFAULT_FEEL: Feel = {
  density: 'generous',
  face: 'serif',
  voice: 'warm',
  numbers: 'shown',
}

/**
 * Shared with the inline bootstrap in `index.html`. **If you rename these, rename them there too** —
 * they are two copies of one contract, and the bootstrap cannot import from this module because it
 * has to run before any bundle is fetched.
 */
export const FEEL_STORAGE_KEYS = {
  density: 'life-manager-density',
  face: 'life-manager-face',
  voice: 'life-manager-voice',
  numbers: 'life-manager-numbers',
} as const

/**
 * The valid values, per key. Exported because `feel.test.ts` walks them: a fourth option added to any
 * of these without a matching CSS block or voice branch is the failure this shape makes findable.
 */
export const FEEL_OPTIONS = {
  density: ['generous', 'compact'],
  face: ['serif', 'grotesk'],
  voice: ['warm', 'plain'],
  numbers: ['shown', 'hidden'],
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
    numbers: readOne('numbers'),
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
 * `voice` and `numbers` are deliberately NOT stamped: nothing in CSS can act on either, and an
 * attribute that no stylesheet reads is a comment pretending to be code.
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
