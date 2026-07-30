/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cn, NAMED_SPACING, RADII, TEXT_SIZES } from './utils'

/**
 * Regression tests for `cn`.
 *
 * These exist because of a bug that shipped **invisible text**: `tailwind-merge` classified the
 * Ledger theme's semantic type scale (`text-row`, `text-body`, …) as colours, so a size utility and a
 * colour utility conflicted and the size won — leaving a primary button rendering ink on ink.
 *
 * Nothing else could catch it. The DOM was right, the accessible name was right, and every component
 * test passed; only the pixels were wrong. So the invariant gets asserted here instead.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This file MUST read `styles.css`, or the guardrail it claims to be cannot fail.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * design.md §1 and CLAUDE.md § Conventions both promise that "a new `--text-*` or `--radius-*` token
 * not declared in `utils.ts` fails here rather than shipping an invisible button". For a while that
 * was false: the walks below iterated `TEXT_SIZES`, `RADII` and `NAMED_SPACING` — the very arrays
 * `cn()` is built from — so they compared `utils.ts` with itself and could never notice a token that
 * existed only in the stylesheet. Adding a token to `styles.css` and forgetting `utils.ts` is
 * precisely the two-file change §1 warns about, and it was the one thing the test could not see.
 *
 * So the source of truth is the stylesheet, parsed below, and the arrays are checked *against* it.
 */

/**
 * `styles.css`, read from disk.
 *
 * ── Three details here are each a dead end someone will otherwise rediscover ──
 *
 *  1. **`node:fs`, not `import '../styles.css?raw'`.** `?raw` is this repo's idiom for reading source
 *     in a test (`TabBar.test.tsx`) and it does not work for a stylesheet: Vitest stubs every CSS
 *     import to the empty string unless `test.css` is enabled, and its check matches on `.css?`, so
 *     the query does not escape it. The import succeeds and yields `''` — a test that reads nothing
 *     and passes, which is the failure this whole file is about.
 *  2. **`/// <reference types="node" />`** rather than editing `tsconfig.json`: this package's `types`
 *     is `["vite/client", …]` with no `node`, so `readFileSync` would otherwise run happily under
 *     Vitest and fail `pnpm typecheck`. The reference pulls the types in for this file alone.
 *  3. **The path is built by string surgery on `import.meta.url`, not `new URL(rel, import.meta.url)`.**
 *     Vite treats that second form as an *asset reference* and rewrites it at transform time, so it
 *     resolves to `http://localhost:3000/src/styles.css` and `fileURLToPath` throws.
 */
const STYLES = readFileSync(
  fileURLToPath(import.meta.url.replace(/\/lib\/[^/]*$/, '/styles.css')),
  'utf8',
)

/**
 * The `@theme` block's declarations of one prefix, with comments stripped first.
 *
 * Stripping is not cosmetic: `styles.css` *explains* these tokens in prose ("Named in `utils.ts`'s
 * NAMED_SPACING…"), so a bare text scan finds the commentary rather than the code — the same trap
 * `TabBar.test.tsx` documents.
 */
const declaredTokens = (prefix: 'text' | 'radius' | 'spacing'): string[] => {
  const css = STYLES.replace(/\/\*[\s\S]*?\*\//g, '')
  const pattern = new RegExp(`--${prefix}-([a-z0-9-]+)\\s*:`, 'g')
  return [...css.matchAll(pattern)].map(([, name]) => name ?? '').sort()
}
describe('cn', () => {
  it('keeps a text COLOUR and a text SIZE together, because they are not the same thing', () => {
    // The exact case that broke: a button variant sets the colour, the size variant sets the scale,
    // and both must survive into the final class list.
    expect(cn('bg-ink text-onink', 'text-row')).toContain('text-onink')
    expect(cn('bg-ink text-onink', 'text-row')).toContain('text-row')
  })

  it('still lets one colour override another', () => {
    // The merging behaviour has to keep working, or `className` overrides from call sites break.
    expect(cn('text-ink', 'text-status-late')).toBe('text-status-late')
    expect(cn('text-ink-3', 'text-ink')).toBe('text-ink')
  })

  it('still lets one size override another', () => {
    expect(cn('text-body', 'text-row')).toBe('text-row')
    expect(cn('text-meta', 'text-display')).toBe('text-display')
  })

  it('covers every size in the theme’s scale', () => {
    // Adding a `--text-*` token to styles.css without adding its name to the `font-size` group in
    // `utils.ts` reintroduces the bug for that one class. The list walked here is the STYLESHEET's,
    // not `TEXT_SIZES` — a token declared only in CSS must fail this, which is the whole claim.
    for (const size of declaredTokens('text')) {
      const result = cn(`text-onink text-${size}`)
      expect(result, `text-${size} swallowed the colour`).toContain('text-onink')
      expect(result, `text-${size} was dropped`).toContain(`text-${size}`)
    }
  })

  /**
   * The three set-equalities, in the direction that actually catches the two-file change.
   *
   * Each failure message names the token, because the useful half of this failing is knowing *which*
   * one drifted — and the fix differs by direction: a token in CSS and not in `utils.ts` needs adding
   * to the array (and to the right axis, below); one in `utils.ts` and not in CSS is a stale name that
   * groups a class Tailwind never emits.
   */
  it('declares exactly the theme’s --text-* scale, no more and no less', () => {
    const declared = declaredTokens('text')
    for (const name of declared) {
      expect(
        TEXT_SIZES,
        `--text-${name} is in styles.css but not in TEXT_SIZES: cn() will treat text-${name} as a COLOUR and silently drop the real one (design.md §1)`,
      ).toContain(name)
    }
    expect([...TEXT_SIZES].sort()).toEqual(declared)
  })

  it('declares exactly the theme’s --radius-* scale', () => {
    const declared = declaredTokens('radius')
    for (const name of declared) {
      expect(
        RADII,
        `--radius-${name} is in styles.css but not in RADII: rounded-${name} lands in no class group, so an override coexists instead of winning`,
      ).toContain(name)
    }
    expect([...RADII].sort()).toEqual(declared)
  })

  it('declares exactly the theme’s named --spacing-* scale', () => {
    const declared = declaredTokens('spacing')
    for (const name of declared) {
      expect(
        NAMED_SPACING,
        `--spacing-${name} is in styles.css but not in NAMED_SPACING: p-${name} / gap-${name} land in no class group, so an override coexists instead of winning`,
      ).toContain(name)
    }
    expect([...NAMED_SPACING].sort()).toEqual(declared)
  })

  it('lets a radius override actually override, rather than coexisting', () => {
    /**
     * The mirror-image bug. Custom radius names are in no class group by default, and classes in no
     * group never conflict — so `cn('rounded-2', 'rounded-pill')` kept BOTH and the winner came down
     * to Tailwind's emission order rather than the call site's intent.
     *
     * `DocumentList`'s "Load 20 more" is precisely this: a `Button` whose variant sets `rounded-2`,
     * with `rounded-pill` passed as `className`.
     */
    expect(cn('rounded-2', 'rounded-pill')).toBe('rounded-pill')
    expect(cn('rounded-3', 'rounded-1')).toBe('rounded-1')
    for (const radius of RADII) {
      expect(cn('rounded-2', `rounded-${radius}`)).toBe(`rounded-${radius}`)
    }
  })

  it('lets an arbitrary height override a named one', () => {
    // `Button`'s sizes set `min-h-field` / `min-h-tap`, and a caller reaching for an exact value has
    // to win. Without the named scale declared, both would survive.
    expect(cn('min-h-field', 'min-h-[3.375rem]')).toBe('min-h-[3.375rem]')
    expect(cn('min-h-tap', 'min-h-field')).toBe('min-h-field')
  })

  it('lets an override win for every named spacing token, on every axis it is grouped under', () => {
    // The density preference moves `--spacing-row-pad`, `-card` and `-stack`, and the call sites that
    // use them (`p-card`, `py-row-pad`, `gap-stack`) sometimes also pass an override. A token added to
    // NAMED_SPACING and forgotten in a class group would coexist rather than override — the
    // `rounded` coin-flip again, this time silently unresponsive to a `className`.
    for (const token of NAMED_SPACING) {
      expect(cn(`p-4 p-${token}`)).toContain(`p-${token}`)
      expect(cn(`p-${token}`, 'p-2')).toBe('p-2')
      expect(cn(`gap-4 gap-${token}`)).toContain(`gap-${token}`)
    }
  })

  it('groups every AXIS a named spacing token is actually used on', () => {
    /**
     * The half of §1's second failure mode that the token lists cannot see.
     *
     * A token is only grouped on the axes named in `utils.ts` — so `--spacing-gutter` being in
     * `NAMED_SPACING` does nothing for `right-gutter` unless `right` is one of them. Both `right`
     * (the Add pill on Documents and Things) and `h` (`Input`'s `h-field`) were in use and ungrouped:
     * no collision yet, and therefore invisible until one shipped.
     *
     * So this reads the source for real usages rather than asserting a list of axes against itself,
     * which would be the same tautology the CSS parse above replaced.
     */
    const sources = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>

    /**
     * Axes that take a COLOUR or a TYPE token which happens to share a name with a spacing token —
     * `text-row` is `--text-row`, `bg-card` is `--color-card`. They are not spacing utilities, so
     * they are not this rule's business. An axis absent from this list is treated as spacing, which
     * is the safe default: a genuinely new one fails until it is grouped.
     */
    const notSpacing = [
      'text',
      'text-serif',
      'serif',
      'bg',
      'border',
      'font',
      'fill',
      'stroke',
      'ring',
      'shadow',
      'rounded',
      'tracking',
      'leading',
      'divide',
      'outline',
      'decoration',
      'accent',
      'caret',
      'placeholder',
    ]

    const tokens = [...NAMED_SPACING].sort((a, b) => b.length - a.length).join('|')
    const usage = new RegExp(`(?<![\\w-])([a-z][a-z-]*?)-(${tokens})(?![\\w-])`, 'g')

    const axes = new Set<string>()
    for (const source of Object.values(sources)) {
      // Comments out first, for the reason `declaredTokens` strips them: this very file discusses
      // `right-gutter` and `h-field` in prose, and a scan that reads its own commentary is asserting
      // against documentation.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')
      for (const [, axis] of code.matchAll(usage)) {
        if (axis !== undefined && !notSpacing.includes(axis)) axes.add(axis)
      }
    }

    // A sanity floor: if the scan ever stops finding the axes we know are used, it has broken rather
    // than passed. `right` and `h` are the two this test was written for.
    expect([...axes].sort()).toEqual(
      expect.arrayContaining(['gap', 'h', 'min-h', 'p', 'px', 'py', 'right']),
    )

    for (const axis of axes) {
      for (const token of NAMED_SPACING) {
        // Exactly one class must survive. Ungrouped, both do — and which one applies is Tailwind's
        // emission order rather than the call site's intent.
        expect(
          cn(`${axis}-4`, `${axis}-${token}`),
          `${axis}-${token} is used but the "${axis}" axis is not grouped in utils.ts, so an override coexists rather than winning`,
        ).toBe(`${axis}-${token}`)
      }
    }
  })

  it('keeps the heading FACE and the heading WEIGHT apart, though both start font-', () => {
    // `font-heading` is a family and `font-face-h` is a weight — the face preference sets one, a
    // headline the other, and they must both survive. Without their groups declared they land
    // ungrouped and their real precedence is stylesheet emission order.
    expect(cn('font-heading font-face-h')).toContain('font-heading')
    expect(cn('font-heading font-face-h')).toContain('font-face-h')
    // And each still overrides its own kind.
    expect(cn('font-serif', 'font-heading')).toBe('font-heading')
    expect(cn('font-normal', 'font-face-h')).toBe('font-face-h')
  })

  it('merges ordinary conflicting utilities as before', () => {
    // A sanity check that extending the config did not disturb the defaults.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('flex', 'hidden')).toBe('hidden')
    expect(cn('px-gutter', 'px-4')).toBe('px-4')
  })
})
