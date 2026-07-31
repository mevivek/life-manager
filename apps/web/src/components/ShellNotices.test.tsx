import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { OfflineNotice } from './OfflineNotice'
import { OutboxNotice } from './OutboxNotice'

/**
 * The two banners in the app shell, checked for the design system they are wearing.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  These render above EVERY authed screen, and they were the last two on pre-Ledger CSS.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * They shipped with shadcn's stock utilities — `text-sm`, `rounded-md`, `bg-muted`, and for the
 * conflict state `bg-destructive/10 border-destructive/50`. Every one of those breaks a rule in
 * design.md: `text-sm` is 14px, below §3's 15px body floor *and* outside the `--text-*` scale, so it
 * does not move with the density preference; `rounded-md` is not a `--radius-*` token (§1); and a
 * red-tinted block is exactly what §4 forbids ("destructive is text in `--status-late`, never a filled
 * red block"), quite apart from mixing a colour out of an alpha channel rather than a token.
 *
 * ── Why classes and not pixels ──
 *
 * Nothing in jsdom compiles Tailwind, so `getComputedStyle` returns nothing useful for a class that
 * was never turned into CSS — the same reason `TabBar.test.tsx` reads text rather than layout. What is
 * assertable, and what actually regressed here, is *which utilities the component asks for*. So these
 * pin the tokens and name the pre-Ledger classes that must not come back.
 */

/** The stock utilities these two banners must never wear again. */
const PRE_LEDGER = [
  'text-sm',
  'rounded-md',
  'bg-muted',
  'text-muted-foreground',
  'bg-destructive/10',
  'border-destructive/50',
]

/** Every class on the element, so an assertion can be made about the set rather than the string. */
const classesOf = (element: Element): string[] => [...element.classList]

function expectSystemTokensOnly(element: Element) {
  const classes = classesOf(element)
  for (const stock of PRE_LEDGER) {
    expect(classes, `${stock} is a pre-Ledger utility (design.md §1, §3, §4)`).not.toContain(stock)
  }
  // A radius from the token scale, and a type size from the `--text-*` scale. `RADII` and
  // `TEXT_SIZES` in `lib/utils.ts` are the same names, which is what makes `cn()` able to merge them.
  expect(classes.some((name) => /^rounded-(1|2|3|4|pill)$/.test(name))).toBe(true)
  expect(
    classes.some((name) =>
      /^text-(display|title|serif-row|head|row|body|meta|label|mask|number)$/.test(name),
    ),
  ).toBe(true)
}

/** `navigator.onLine` is a getter on the prototype in jsdom, so it is stubbed rather than assigned. */
function setOnline(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('OfflineNotice', () => {
  it('wears the Ledger: a token radius, the body size, and quiet ink', () => {
    setOnline(false)
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OfflineNotice />
      </QueryClientProvider>,
    )

    const banner = screen.getByRole('status')
    expectSystemTokensOnly(banner)
    // `text-body` specifically — 15px is §3's floor and the smallest size a whole sentence may use.
    expect(classesOf(banner)).toContain('text-body')
    expect(classesOf(banner)).toContain('text-ink-2')
    // Unchanged: what it says and when it appears. Only how it is dressed moved.
    expect(banner.textContent).toContain('Offline')
    expect(banner.textContent).toContain('Edits are queued')
  })

  it('says nothing at all while online, which is still the only condition for showing it', () => {
    setOnline(true)
    render(
      <QueryClientProvider client={createQueryClient()}>
        <OfflineNotice />
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('status')).toBeNull()
  })
})

/**
 * `Link` is stubbed to an `<a>`.
 *
 * The subject here is the class list, and standing up a memory router with two routes to obtain one
 * anchor would be more setup than the thing being asserted. `to` becomes `href` so the element still
 * has a link role.
 */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))

const mockOutbox = vi.hoisted(() => vi.fn())
vi.mock('@/features/outbox/useOutbox', () => ({ useOutbox: mockOutbox }))

describe('OutboxNotice', () => {
  it('draws a conflict with the status TINT, not a filled red block', () => {
    setOnline(true)
    mockOutbox.mockReturnValue({ pending: [], conflicts: [{ id: '1' }] })
    render(<OutboxNotice />)

    const banner = screen.getByRole('link')
    expectSystemTokensOnly(banner)
    // §4's sanctioned way to say "past its date" on a ground: the tint token plus a hairline, with
    // ordinary ink on top. `Alert variant="destructive"` and a detail screen's `STATUS_BG` agree.
    expect(classesOf(banner)).toContain('bg-status-late-bg')
    expect(classesOf(banner)).toContain('border-rule-2')
    expect(classesOf(banner)).toContain('text-ink')
    // And no second red, mixed from the alias or otherwise.
    expect(classesOf(banner).filter((name) => name.includes('destructive'))).toEqual([])
    expect(banner.textContent).toContain('1 change needs your attention')
  })

  it('draws pending writes as a quiet notice, in the same tokens as the offline banner', () => {
    setOnline(true)
    mockOutbox.mockReturnValue({ pending: [{ id: '1' }, { id: '2' }], conflicts: [] })
    render(<OutboxNotice />)

    // `role="status"` is set explicitly on the pending banner and overrides the anchor's link role —
    // deliberate, and the reason this query differs from the conflict one above.
    const banner = screen.getByRole('status')
    expectSystemTokensOnly(banner)
    expect(classesOf(banner)).toContain('bg-sunken')
    expect(classesOf(banner)).toContain('text-body')
    expect(banner.textContent).toContain('2 changes waiting to send')
    // Unchanged by the redress: the promise about reconnecting is only made while offline.
    expect(banner.textContent).not.toContain('back online')
  })

  it('still renders nothing when the queue is empty', () => {
    setOnline(true)
    mockOutbox.mockReturnValue({ pending: [], conflicts: [] })
    const { container } = render(<OutboxNotice />)

    expect(container.firstChild).toBeNull()
  })
})
