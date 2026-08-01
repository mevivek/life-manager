import type { Document } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
/*
 * `?raw` rather than `node:fs`. This package's tsconfig sets `types: ["vite/client", …]` and no
 * `node`, so `readFileSync` typechecks as an unknown global even though Vitest runs it happily —
 * `pnpm test` would pass and `pnpm typecheck` would fail. Vite's raw import is the idiomatic way to
 * read a file as a string in this stack, and `vite/client` already declares it.
 */
import rootSourceRaw from '../routes/__root.tsx?raw'
import { TabBar } from './TabBar'
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

// ── The tab set, and which one is lit ─────────────────────────────────────────

/**
 * These DO render, unlike everything above — because what they assert is DOM, not pixels.
 *
 * Which tab carries `aria-current="page"` is the whole of "you are here" for a screen reader, and it is
 * decided by a `startsWith` on the pathname that a source-text test cannot exercise. A detail route is
 * the case that breaks: `/things/$thingId` must keep the Things tab lit, because a bar that goes blank
 * one level down tells the user they have left the app's structure.
 */

/** A document with only the fields the ledger badge reads. Deliberately not a full fixture. */
function ledgerDocument(overrides: Partial<Document> & { id: string }): Document {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
    title: 'Passport',
    doc_type: 'identity',
    issuer: null,
    holder: null,
    relation: null,
    identifier: null,
    thing_id: null,
    issued_on: null,
    expires_on: null,
    country: null,
    notes: null,
    tags: [],
    custom_attrs: {},
    file_count: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * The bar, mounted at `path`, with the four routes it links to so every `<Link>` resolves.
 *
 * `RouterProvider` renders nothing until the first match resolves, so awaiting `load()` is what makes
 * the assertions synchronous afterwards rather than a pile of `waitFor`s. The query client is built
 * once per call, not per render, for the reason `things.test.tsx` records: a client created in a
 * component body is a new client on every render, and every in-flight query dies with the old one.
 */
async function renderBarAt(path: string, documents: Document[] = []) {
  /**
   * The ledger handler is installed HERE rather than per test, and the order matters.
   *
   * `setup.ts` sets `onUnhandledRequest: 'error'`, and there is no global `/api/v1/documents` handler
   * — so mounting the bar without one fails on the badge's fetch rather than on anything being
   * asserted. `server.use` *prepends*, so a handler a test installed before calling this would be
   * shadowed by this one; passing the documents in is what keeps one handler and one winner.
   */
  server.use(
    http.get('*/api/v1/documents', () => HttpResponse.json({ data: documents, next_cursor: null })),
  )
  const queryClient = createQueryClient()
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <TabBar />
      </QueryClientProvider>
    ),
  })
  const children = [
    createRoute({ getParentRoute: () => rootRoute, path: '/home', component: () => null }),
    // `/library` is the Everything tab's own route; `/documents` and `/things` are the redirect
    // stubs, and both detail routes still light it. All five are declared so the bar is asserted
    // against real matches rather than against the router's not-found fallback.
    createRoute({ getParentRoute: () => rootRoute, path: '/library', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/outbox', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/documents', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/documents/$documentId',
      component: () => null,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/things', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/things/$thingId',
      component: () => null,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/you', component: () => null }),
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

/** The tab whose `aria-current` says "you are here", by its visible label. */
function currentTabLabel(): string | null {
  const current = screen
    .getAllByRole('link')
    .find((link) => link.getAttribute('aria-current') === 'page')
  return current?.textContent?.trim() ?? null
}

describe('the tab set', () => {
  it('is three tabs, in the comp’s order: Now · Everything · You', async () => {
    // ADR-0032. The bar has now been three, four (ADR-0031, when Things became its own tab) and three
    // again — this time because the two collections MERGED rather than because one was hidden behind
    // the other. Asserting the ORDER as well as the set, because the bar's order is the comp's and a
    // tab inserted after You would read as an afterthought.
    await renderBarAt('/home')
    expect(screen.getAllByRole('link').map((link) => link.textContent?.trim())).toEqual([
      'Now',
      'Everything',
      'You',
    ])
  })

  it('links Everything at a bare `/library`, with no search params to supply', async () => {
    // `library.tsx`'s search schema carries `.default()` on all ten fields precisely so this link
    // typechecks. If those defaults are removed the router demands every one of them here.
    await renderBarAt('/home')
    expect(screen.getByRole('link', { name: 'Everything' })).toHaveAttribute('href', '/library')
  })
})

describe('which tab is lit', () => {
  it('lights Everything on the library itself', async () => {
    await renderBarAt('/library')
    expect(currentTabLabel()).toBe('Everything')
  })

  it('lights Everything from a thing’s detail route', async () => {
    // The multi-prefix match, which is the whole reason this test renders. `/things/$thingId` is not
    // under `/library`, so a single `startsWith` would blank the bar one level down — which tells the
    // user they have left the app's structure.
    await renderBarAt('/things/33333333-3333-4333-8333-333333333333')
    expect(currentTabLabel()).toBe('Everything')
  })

  it('lights Everything from a document’s detail route too — both collections, one tab', async () => {
    // The claim the four-tab bar could not make, and the point of the merge: a document and a thing
    // are the same *place* now, so walking into either keeps the same tab lit rather than swapping
    // which one is current.
    await renderBarAt('/documents/44444444-4444-4444-8444-444444444444')
    expect(currentTabLabel()).toBe('Everything')
  })

  it('lights exactly one tab, never two', async () => {
    await renderBarAt('/you')
    const lit = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page')
    expect(lit).toHaveLength(1)
    expect(lit[0]?.textContent?.trim()).toBe('You')
  })

  it('does not light Everything from an unrelated route', async () => {
    // The control case for a three-prefix match: `/outbox` shares no prefix with any of them, and a
    // sloppy `some()` (an empty match list, say) would light the tab everywhere.
    await renderBarAt('/outbox')
    expect(currentTabLabel()).toBeNull()
  })
})

describe('the Now badge, with the library tab beside it', () => {
  it('stays off when nothing is dated, and Everything keeps the current marker', async () => {
    // The badge is the one piece of the bar that carries meaning rather than navigation, and changing
    // the tab set is exactly the kind of change that moves it onto the wrong link.
    await renderBarAt('/library', [
      ledgerDocument({ id: 'aaaaaaa1-0000-4000-8000-000000000000', expires_on: null }),
    ])

    // No expiry ⇒ nothing needs attention ⇒ no badge, and the Now link keeps its plain name.
    expect(screen.getByRole('link', { name: 'Now' })).toBeInTheDocument()
    expect(currentTabLabel()).toBe('Everything')
  })

  it('names the count on the Now link when something is expired', async () => {
    // A non-zero count, asserted deliberately — debt D33's lesson. `aria-hidden` on the badge plus the
    // sentence on the link is design.md §9's rule; a bare "1" beside "Now" announces "Now 1", which
    // says nothing about what the one is.
    await renderBarAt('/home', [
      ledgerDocument({
        id: 'aaaaaaa2-0000-4000-8000-000000000000',
        // Well past, so `needsYou` is true whatever today is — a fixed future date would rot into the
        // wrong state as the suite ages.
        expires_on: '2020-01-01',
      }),
    ])

    expect(
      await screen.findByRole('link', { name: 'Now — 1 document needs attention' }),
    ).toBeInTheDocument()
  })
})
