import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *  `tailwind-merge` MUST be told which `text-*` utilities are sizes, or it silently eats colours.
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 *
 * This is not a tidy-up. It is the fix for a real bug that shipped invisible text.
 *
 * `text-` is ambiguous in Tailwind: `text-red-500` is a colour and `text-lg` is a font size. Out of
 * the box, tailwind-merge resolves that by recognising t-shirt sizes (`sm`, `lg`, `2xl`) as sizes and
 * treating **everything else as a colour**. The Ledger theme (ADR-0025) names its scale semantically
 * — `text-row`, `text-body`, `text-meta` — so none of them look like a size, and all of them landed
 * in the colour group alongside `text-ink` and `text-onink`.
 *
 * Two classes in the same group *conflict*, and the last one wins. So:
 *
 *     cn('bg-ink text-onink', 'text-row')   →   'bg-ink text-row'
 *
 * `text-onink` was dropped, the button inherited `text-ink` from its card, and "Turn on reminders"
 * rendered as **ink on ink** — a solid black rectangle with invisible text. Found by screenshotting
 * the Now screen at 390px, not by any test: the DOM was correct and the accessible name was correct,
 * so nothing failed. Only the pixels were wrong.
 *
 * Declaring the size scale here separates the two groups, so a size and a colour can coexist. Every
 * name below must match a `--text-*` token in `styles.css`; adding one there without adding it here
 * reintroduces exactly this bug for that class.
 */
/**
 * The theme's `--text-*` scale, so a size is not mistaken for a colour. See above.
 *
 * Exported for `utils.test.ts`, which walks it — a token added to `styles.css` and forgotten here is
 * the exact regression that test exists to catch.
 */
export const TEXT_SIZES = [
  'display',
  'title',
  'serif-row',
  'head',
  'row',
  'body',
  'meta',
  'label',
  'mask',
] as const

/**
 * The theme's `--radius-*` scale, for the OPPOSITE failure to the one above.
 *
 * Here the names are unrecognised, so tailwind-merge puts them in no group at all — and classes in no
 * group never conflict. `cn('rounded-2', 'rounded-pill')` therefore kept **both**, and which one
 * actually applied came down to the order Tailwind happened to emit them in the stylesheet rather
 * than to the override the call site wrote. `DocumentList`'s "Load 20 more" is exactly that case: a
 * `Button` whose variant sets `rounded-2`, with `rounded-pill` passed as a `className`.
 *
 * A silent coin-flip is worse than a visible override losing, so the scale is declared.
 */
export const RADII = ['1', '2', '3', '4', 'pill'] as const

/**
 * Named spacing (`--spacing-*`), for the same reason as the radii: `Button`'s sizes set `min-h-field`
 * and `min-h-tap`, and a caller that overrides with an arbitrary `min-h-[3.375rem]` must win rather
 * than coexist.
 */
const NAMED_SPACING = ['gutter', 'tap', 'row', 'field'] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...TEXT_SIZES] }],
      rounded: [{ rounded: [...RADII] }],
      'min-h': [{ 'min-h': [...NAMED_SPACING] }],
      p: [{ p: [...NAMED_SPACING] }],
      px: [{ px: [...NAMED_SPACING] }],
      py: [{ py: [...NAMED_SPACING] }],
      mx: [{ mx: [...NAMED_SPACING] }],
    },
  },
})

/** The class-name helper shadcn/ui components expect. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
