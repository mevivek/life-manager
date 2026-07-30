import { describe, expect, it } from 'vitest'
/*
 * `?raw` rather than `node:fs`. This package's tsconfig sets `types: ["vite/client", …]` and no
 * `node`, so `readFileSync` typechecks as an unknown global even though Vitest runs it happily —
 * `pnpm test` would pass and `pnpm typecheck` would fail. Vite's raw import is the idiomatic way to
 * read a file as a string in this stack, and `vite/client` already declares it.
 */
import rootSourceRaw from '../routes/__root.tsx?raw'
import tabBarSourceRaw from './TabBar.tsx?raw'

/**
 * The tab bar's geometry, asserted by reading the source.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why source text and not a rendered DOM
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The thing worth protecting is that **two files agree about one number**: the bar pads itself with
 * `max(env(safe-area-inset-bottom), 0.75rem)`, and `__root.tsx` reserves that same amount plus
 * breathing room so page content clears the bar. Nothing in jsdom can check it — `env()` resolves to
 * nothing there, Tailwind's arbitrary values are never compiled, and `getComputedStyle` on a class
 * that was never turned into CSS returns `0px` for both. A rendering test would pass whatever the
 * numbers said.
 *
 * So this reads the two class strings and compares them, which is exactly the class of bug that has
 * already shipped twice here: correct markup, correct accessible names, wrong pixels (debt D42, D43).
 *
 * ── What went wrong, and what this stops recurring ──
 *
 * The page reserved a flat `pb-28` (112px) for a bar that is 94px on a home-indicator iPhone and 72px
 * elsewhere, leaving 17px and 40px of dead paper above it respectively — reported from a real phone as
 * a gap around the tab bar. Deriving one from the other makes the gap a constant 8px. That only stays
 * true while the two expressions match, and a duplicated magic number with no test is a duplicated
 * magic number that drifts.
 */

/**
 * The source with its comments removed.
 *
 * Stripping matters more than it looks. Both files *explain* the old values in prose — "it used to be
 * a flat `pb-28`", "this had `1.625rem`" — so a bare text search finds the very thing it is asserting
 * the absence of and fails on the documentation rather than the code. Which is its own small lesson: a
 * source-reading test has to read the source, not the commentary around it.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '')

const tabBarSource = withoutComments(tabBarSourceRaw)
const rootSource = withoutComments(rootSourceRaw)

/** The safe-area floor, as written in both files. Changing it means changing it in both. */
const FLOOR = '0.75rem'
/** The bar's content region: `pt-2` (8px) plus the links' `min-h-[3.25rem]` (52px). */
const CONTENT_REM = 0.5 + 3.25
/** One step of breathing room between the last content and the bar's hairline. */
const BREATHING_REM = 0.5

describe('tab bar geometry', () => {
  it('pads itself with the safe-area inset, floored at the design’s 12px', () => {
    // The handoff specifies `max(env(safe-area-inset-bottom), 12px)`. This was `1.625rem` — `--gutter`,
    // the HORIZONTAL screen gutter, borrowed as a vertical floor, which put 14px of unexplained blank
    // paper under the labels on every device without a home indicator.
    expect(tabBarSource).toContain(`pb-[max(env(safe-area-inset-bottom),${FLOOR})]`)
  })

  it('keeps the content region the two halves of the bar’s height are measured from', () => {
    // If either of these changes the page's reserved space is wrong by the difference, silently.
    expect(tabBarSource).toContain('pt-2')
    expect(tabBarSource).toContain('min-h-[3.25rem]')
  })

  it('reserves exactly the bar’s height plus breathing room on the page below it', () => {
    // The assertion that matters: derive the expected string from the bar's own numbers, so a change
    // to the bar that is not mirrored here fails rather than shipping a gap.
    const expected = `pb-[calc(max(env(safe-area-inset-bottom),${FLOOR})+${CONTENT_REM + BREATHING_REM}rem)]`
    expect(rootSource).toContain(expected)
  })

  it('does not reserve a flat constant, which cannot clear a device-dependent bar', () => {
    // The specific regression. `pb-28` looks harmless and is wrong on every device.
    expect(rootSource).not.toMatch(/\bpb-28\b/)
  })

  it('leaves the bottom inset to the bar alone, so its ground reaches the screen edge', () => {
    // Padding rather than margin, and only in one place. Two elements both applying the bottom inset
    // is how a strip of page ends up showing beneath the bar — the reason it came off `body`.
    const insetUses = tabBarSource.match(/env\(safe-area-inset-bottom\)/g) ?? []
    expect(insetUses).toHaveLength(1)
    expect(rootSource).not.toMatch(/pb-\[env\(safe-area-inset-bottom\)\]/)
  })
})
