import { describe, expect, it } from 'vitest'
import { cn, RADII, TEXT_SIZES } from './utils'

/**
 * Regression tests for `cn`.
 *
 * These exist because of a bug that shipped **invisible text**: `tailwind-merge` classified the
 * Ledger theme's semantic type scale (`text-row`, `text-body`, …) as colours, so a size utility and a
 * colour utility conflicted and the size won — leaving a primary button rendering ink on ink.
 *
 * Nothing else could catch it. The DOM was right, the accessible name was right, and every component
 * test passed; only the pixels were wrong. So the invariant gets asserted here instead.
 */
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
    // `utils.ts` reintroduces the bug for that one class. Walking the exported list is what keeps the
    // two in step.
    for (const size of TEXT_SIZES) {
      const result = cn(`text-onink text-${size}`)
      expect(result, `text-${size} swallowed the colour`).toContain('text-onink')
      expect(result, `text-${size} was dropped`).toContain(`text-${size}`)
    }
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

  it('merges ordinary conflicting utilities as before', () => {
    // A sanity check that extending the config did not disturb the defaults.
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('flex', 'hidden')).toBe('hidden')
    expect(cn('px-gutter', 'px-4')).toBe('px-4')
  })
})
