/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TABS } from '@/components/TabBar'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The orientation docs, checked mechanically.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `CLAUDE.md` is loaded into every session. It grew 23 KB → 42 KB across 24 commits without one of
 * them ever making it smaller, and came to contradict itself five times — including about how many
 * tabs the app has, in the routing-table row a layout session reads. A fresh session got two answers
 * and followed whichever it read last, which is the mechanical cause of "the session didn't follow
 * the plan".
 *
 * Every rule below was already written in prose somewhere, and prose did not hold any of them. The
 * one that matters most is the byte cap: it is the only check that forces a session to RECONCILE
 * rather than append, because the only way to add is to remove.
 *
 * Why this lives in apps/web: it needs no database, so it runs in every container. The API's suites
 * skip without Postgres (ADR-0018), and a guardrail that does not run is not a guardrail.
 *
 * NOTE on reading files here, measured rather than assumed: `new URL('../../../../', import.meta.url)
 * .pathname` yields `/@fs/home/user/...` under Vitest, so the first draft of this file died on
 * `ENOENT: .../life-managerCLAUDE.md`. And `?raw` does not work either — Vitest stubs those imports.
 * Use string surgery on `import.meta.url` plus `fileURLToPath`, exactly as `utils.test.ts` does and
 * for the same reason.
 */

const read = (rel: string) =>
  readFileSync(fileURLToPath(import.meta.url.replace(/apps\/web\/src\/lib\/[^/]*$/, rel)), 'utf8')

const CLAUDE_MD = read('CLAUDE.md')
const REVIEW_MD = read('docs/product/review.md')

/**
 * 16 KiB. Set with roughly 2.5 KB of headroom over the size at which it was introduced (13,832 B),
 * so an ordinary correction does not turn the build red for no reason.
 *
 * **Ratchet this DOWN, never up.** Raising it is the append this test exists to prevent — if a change
 * genuinely needs the space, take the space from somewhere else in the file. A war story belongs in
 * the debt register, a rule in its convention doc, a decision in an ADR, status in the roadmap.
 */
const CLAUDE_MD_MAX_BYTES = 16 * 1024

describe('CLAUDE.md stays a router', () => {
  it('is under the byte cap — to add something, remove something', () => {
    const bytes = Buffer.byteLength(CLAUDE_MD, 'utf8')
    expect(
      bytes,
      `CLAUDE.md is ${bytes} B, over the ${CLAUDE_MD_MAX_BYTES} B cap by ${bytes - CLAUDE_MD_MAX_BYTES} B.\n` +
        'Do NOT raise the cap — that is the append this test exists to prevent. Move something out:\n' +
        '  a war story  -> docs/product/review.md, as a debt row with a trigger\n' +
        '  a rule       -> the matching docs/conventions/*.md\n' +
        '  a decision   -> a new ADR under docs/decisions/\n' +
        '  status       -> docs/roadmap.md § Current position',
    ).toBeLessThanOrEqual(CLAUDE_MD_MAX_BYTES)
  })

  /**
   * The specific contradiction that shipped: Status said four tabs while the routing table still said
   * "three tabs, forever", citing an ADR that had been reversed. ADR-0031 made Things a fourth tab and
   * deleted DomainSwitcher; the doc was updated in one place and not the other.
   *
   * The count has since changed twice more — ADR-0032 merged the two collections and the bar is three
   * tabs again — which is exactly why this is checked against `TABS` rather than against a literal.
   * The assertion below never needed editing for any of it.
   */
  it('states the same number of tabs that TabBar actually renders', () => {
    const written = CLAUDE_MD.match(/\*\*(One|Two|Three|Four|Five|Six) tabs/i)
    expect(written, 'CLAUDE.md no longer states a tab count in the expected form').not.toBeNull()

    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']
    const claimed = words.indexOf((written?.[1] ?? '').toLowerCase())
    expect(
      claimed,
      `CLAUDE.md says "${written?.[1]} tabs" but TabBar.tsx renders ${TABS.length}: ` +
        `${TABS.map((t) => t.label).join(' · ')}. ` +
        'Fix the doc, and delete any OTHER line in it that states a different count — ' +
        'leaving both is how this broke the first time.',
    ).toBe(TABS.length)
  })

  /**
   * ── This used to hardcode the wrong count, and that made it wrong twice ──
   *
   * It read `not.toMatch(/three tabs/i)`, because at the time "three tabs, forever" was the stale
   * claim ADR-0031 had just reversed. ADR-0032 merged the collections and the bar is three tabs
   * again — so the literal it banned became the correct answer, and the test would have failed the
   * build for stating the truth.
   *
   * The durable version bans **every count except the one `TABS` actually has**. It cannot rot,
   * because the thing it compares against is the source rather than a snapshot of it.
   */
  it('does not state a tab count anywhere that a superseding ADR has replaced', () => {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six']
    const stale = words.filter(
      (word, index) =>
        index !== TABS.length && new RegExp(`\\b${word} tabs\\b`, 'i').test(CLAUDE_MD),
    )
    expect(
      stale,
      `CLAUDE.md still says "${stale.join('", "')} tabs" somewhere, but the bar has ${TABS.length}. ` +
        'Delete the line rather than adding a caveat beside it — leaving both is how this broke the ' +
        'first time.',
    ).toEqual([])
  })

  it('does not claim any tab count is permanent', () => {
    // "three tabs, forever" (ADR-0025 §4) was written once and broken twice — by ADR-0031, then by
    // ADR-0032. design.md §8 holds the 390px measurement that decides when the bar is full.
    expect(
      CLAUDE_MD,
      'CLAUDE.md claims a tab count is permanent. No count is forever; §8 holds the measurement.',
    ).not.toMatch(/tabs,? forever/i)
  })
})

describe('the debt register is citable', () => {
  const ids = [...REVIEW_MD.matchAll(/^\| D(\d+) \|/gm)].map((m) => Number(m[1]))

  it('has no duplicate ids', () => {
    const seen = new Map<number, number>()
    for (const id of ids) seen.set(id, (seen.get(id) ?? 0) + 1)
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => `D${id}`)
    expect(
      dupes,
      `Duplicate debt ids: ${dupes.join(', ')}. D42 and D43 each named two unrelated debts for weeks, ` +
        'which made every cross-reference to them ambiguous. Renumber the later row.',
    ).toEqual([])
  })

  it('is sorted ascending, which is how a duplicate becomes visible', () => {
    expect(
      ids,
      'The register is out of order. It was four separate tables split by blank lines when the ' +
        'duplicate ids went unnoticed — order is what makes them obvious.',
    ).toEqual([...ids].sort((a, b) => a - b))
  })

  it('is one contiguous table with no gaps', () => {
    const missing: string[] = []
    for (let i = 1; i <= Math.max(...ids); i++) if (!ids.includes(i)) missing.push(`D${i}`)
    expect(missing, `Debt ids missing from the register: ${missing.join(', ')}`).toEqual([])
  })

  it('covers the range CLAUDE.md advertises', () => {
    const range = CLAUDE_MD.match(/\*\*D1[–-]D(\d+)\*\*/)
    expect(range, 'CLAUDE.md no longer advertises a debt range in the expected form').not.toBeNull()
    expect(
      Number(range?.[1]),
      `CLAUDE.md advertises D1–D${range?.[1]} but the register ends at D${Math.max(...ids)}.`,
    ).toBe(Math.max(...ids))
  })

  it('contains every debt CLAUDE.md cites', () => {
    const cited = [...new Set([...CLAUDE_MD.matchAll(/\bD(\d+)\b/g)].map((m) => Number(m[1])))]
    const dangling = cited.filter((id) => !ids.includes(id)).map((id) => `D${id}`)
    expect(
      dangling,
      `CLAUDE.md cites ${dangling.join(', ')}, which the register does not define. ` +
        'A citation a session cannot resolve is worse than no citation.',
    ).toEqual([])
  })
})
