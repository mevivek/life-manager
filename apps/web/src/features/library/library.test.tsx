import type { Document, Thing } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { routeTree } from '@/routeTree.gen'
import { server } from '@/test/msw'

/**
 * The library screen — ADR-0032. **What the merge actually shows a user.**
 *
 * `mergeRows.test.ts` covers the ordering arithmetic; this covers the three claims that are only true
 * once it is on screen: that one list holds both kinds, that the scope pills narrow rather than
 * navigate, and that Add asks which track instead of guessing.
 *
 * These mount the **real route tree** rather than a hand-built one, because half of what is being
 * asserted is routing: the search params, the redirects from `/documents` and `/things`, and the fact
 * that changing scope stays on one route. A synthetic router would let all of that pass while the app
 * did something else.
 *
 * MSW intercepts at the network layer, so the real `lib/api` client and its real Zod parsing run — a
 * fixture that drifts from the contract fails here rather than in production.
 */

const SPACE = '22222222-2222-4222-8222-222222222222'

function document(over: Partial<Document> & { id: string; title: string }): Document {
  return {
    space_id: SPACE,
    doc_type: 'other',
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
    file_count: 1,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function thing(over: Partial<Thing> & { id: string; name: string }): Thing {
  return {
    space_id: SPACE,
    kind: 'other',
    brand: null,
    model: null,
    serial: null,
    purchased_on: null,
    price: null,
    currency: null,
    warranty_ends_on: null,
    service_every_months: null,
    service_due_on: null,
    kept_at: null,
    holder: null,
    relation: null,
    ownership: 'here',
    ownership_who: null,
    ownership_since: null,
    notes: null,
    document_count: 0,
    photo_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  }
}

const PASSPORT = document({
  id: 'aaaaaaa1-0000-4000-8000-000000000000',
  title: 'Passport',
  expires_on: '2026-09-12',
})
const SWIFT = thing({
  id: 'bbbbbbb1-0000-4000-8000-000000000000',
  name: 'Maruti Swift',
  service_due_on: '2026-08-20',
})

/**
 * The session and both collections. `server.use` **prepends**, so these shadow the defaults in
 * `test/msw.ts` — and every handler a test needs has to be installed before the render, because
 * `setup.ts` sets `onUnhandledRequest: 'error'` and an unstubbed call fails on the fetch rather than
 * on anything being asserted.
 */
function stubApi({
  documents = [PASSPORT],
  things = [SWIFT],
}: {
  documents?: Document[]
  things?: Thing[]
} = {}) {
  server.use(
    http.get('*/api/v1/documents', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')
      const matched =
        q === null
          ? documents
          : documents.filter((d) => d.title.toLowerCase().includes(q.toLowerCase()))
      return HttpResponse.json({ data: matched, next_cursor: null })
    }),
    http.get('*/api/v1/documents/holders', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/things', ({ request }) => {
      const q = new URL(request.url).searchParams.get('q')
      const matched =
        q === null ? things : things.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()))
      return HttpResponse.json({ data: matched, next_cursor: null })
    }),
    http.get('*/api/v1/things/holders', () => HttpResponse.json({ data: [] })),
  )
}

/**
 * Mount the app's real route tree at `path`.
 *
 * The query client is built once per call rather than inside a component, for the reason
 * `things.test.tsx` records: a client created in a component body is a new client on every render, so
 * every in-flight query dies with the old one and `isSuccess` never arrives.
 */
async function renderAt(path: string) {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
  return { ...result, router }
}

/** The scope pill row, by its legend — so a chip elsewhere on the screen cannot be mistaken for one. */
function scopePills() {
  return within(screen.getByRole('group', { name: 'Show' }))
}

beforeEach(() => {
  stubApi()
})

describe('the library holds both collections', () => {
  it('shows a document and a thing in ONE list, under one heading', async () => {
    // The whole claim of ADR-0032. Two screens could each show one of these; nothing could show both.
    await renderAt('/library')

    expect(await screen.findByRole('heading', { name: 'Everything' })).toBeInTheDocument()
    expect(await screen.findByText('Passport')).toBeInTheDocument()
    expect(await screen.findByText('Maruti Swift')).toBeInTheDocument()
  })

  it('orders them by the date that bites first, not by kind', async () => {
    // The Swift's service is due 20 Aug; the passport expires 12 Sep. Grouped by kind the document
    // would come first, since documents are concatenated first — so this fails if the merge groups.
    await renderAt('/library')
    await screen.findByText('Passport')

    const names = screen
      .getAllByRole('link')
      .map((link) => link.textContent ?? '')
      .filter((text) => text.includes('Passport') || text.includes('Maruti Swift'))

    expect(names[0]).toContain('Maruti Swift')
    expect(names[1]).toContain('Passport')
  })

  it('counts both kinds together', async () => {
    await renderAt('/library')
    expect(await screen.findByText('2')).toBeInTheDocument()
  })
})

describe('the scope pills narrow, they do not navigate', () => {
  it('stays on /library and moves the scope into the URL', async () => {
    // If these were `<Link>`s the pathname would change and Back would walk pill by pill. `scope.ts`
    // argues the case; this is the assertion that holds it.
    const user = userEvent.setup()
    const { router } = await renderAt('/library')
    await screen.findByText('Passport')

    await user.click(scopePills().getByRole('button', { name: 'Things' }))

    await waitFor(() => expect(router.state.location.search).toMatchObject({ scope: 'things' }))
    expect(router.state.location.pathname).toBe('/library')
  })

  it('drops the other kind when a scope is chosen', async () => {
    const user = userEvent.setup()
    await renderAt('/library')
    await screen.findByText('Passport')

    await user.click(scopePills().getByRole('button', { name: 'Things' }))

    await waitFor(() => expect(screen.queryByText('Passport')).not.toBeInTheDocument())
    expect(screen.getByText('Maruti Swift')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Things' })).toBeInTheDocument()
  })

  it('announces the current scope with aria-pressed, not aria-current', async () => {
    // `aria-current="page"` would claim a second location while the tab bar already claims one.
    await renderAt('/library')
    await screen.findByText('Passport')

    const all = scopePills().getByRole('button', { name: 'All' })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    expect(all).not.toHaveAttribute('aria-current')
  })
})

describe('the old collection URLs still land somewhere real', () => {
  // The PWA is installed on a phone and can hold a saved URL; a 404 would be the first thing that
  // user sees. Both redirects carry their search params across.
  it('forwards /documents into the Documents scope', async () => {
    const { router } = await renderAt('/documents')
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
    expect(router.state.location.search).toMatchObject({ scope: 'documents' })
  })

  it('forwards /things into the Things scope', async () => {
    const { router } = await renderAt('/things')
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
    expect(router.state.location.search).toMatchObject({ scope: 'things' })
  })

  it('keeps the Now screen’s no-scan deep link working', async () => {
    // `?scan=no` is why the archive's filters were moved into the URL in the first place. A redirect
    // that dropped it would leave the nudge pointing at an unfiltered list.
    const { router } = await renderAt('/documents?scan=no')
    await waitFor(() => expect(router.state.location.pathname).toBe('/library'))
    expect(router.state.location.search).toMatchObject({ scope: 'documents', scan: 'no' })
  })
})

describe('search folds away, and says so when it is on', () => {
  it('is a toggle: no field until it is asked for', async () => {
    const user = userEvent.setup()
    await renderAt('/library')
    await screen.findByText('Passport')

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Search everything' }))
    expect(await screen.findByRole('searchbox', { name: 'Search everything' })).toBeInTheDocument()
  })

  it('searches across both kinds and counts each', async () => {
    const user = userEvent.setup()
    await renderAt('/library')
    await screen.findByText('Passport')

    await user.click(screen.getByRole('button', { name: 'Search everything' }))
    await user.type(await screen.findByRole('searchbox'), 'swift')

    // The question a merged list makes newly askable: is this everything, or did the other kind just
    // not match? A non-zero count on one side and a zero on the other, per D33's rule.
    expect(await screen.findByText(/0 documents · 1 thing match/)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Passport')).not.toBeInTheDocument())
  })

  it('clears the query when the field is closed, so nothing narrows invisibly', async () => {
    // The failure this prevents: a user sees a short list, does not remember searching, and concludes
    // records are missing.
    const user = userEvent.setup()
    const { router } = await renderAt('/library')
    await screen.findByText('Passport')

    await user.click(screen.getByRole('button', { name: 'Search everything' }))
    await user.type(await screen.findByRole('searchbox'), 'swift')
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'swift' }))

    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ q: '', search: false }),
    )
    expect(await screen.findByText('Passport')).toBeInTheDocument()
  })
})

describe('Add asks which track', () => {
  it('opens the picker rather than starting the document wizard', async () => {
    // design.md §8's "each domain keeps its own Add" was a rule about two screens. Above a list
    // holding both kinds the answer is not on screen, so guessing it is wrong about half the time.
    const user = userEvent.setup()
    await renderAt('/library')
    await screen.findByText('Passport')

    await user.click(screen.getByRole('button', { name: 'Add' }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('What are you adding?')).toBeInTheDocument()
    expect(within(sheet).getByText('A document')).toBeInTheDocument()
    expect(within(sheet).getByText('A thing you own')).toBeInTheDocument()
  })

  it('hands off to the capture wizard once a track is picked', async () => {
    const user = userEvent.setup()
    await renderAt('/library')
    await screen.findByText('Passport')

    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(await screen.findByText('A document'))

    // The picker is gone and the wizard is up — one dialog, never two stacked.
    await waitFor(() => {
      expect(screen.queryByText('What are you adding?')).not.toBeInTheDocument()
    })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
})

describe('an empty library', () => {
  it('says nothing is filed rather than that nothing matches', async () => {
    // Two different emptinesses, two different answers. Collapsing them tells someone with a filter
    // on that they own nothing.
    stubApi({ documents: [], things: [] })
    await renderAt('/library')

    expect(await screen.findByText('Nothing filed yet')).toBeInTheDocument()
    expect(screen.queryByText('Nothing matches')).not.toBeInTheDocument()
  })
})

describe('a row does not change shape when the scope changes', () => {
  /**
   * ── The defect this suite exists for ──
   *
   * The first cut of the library built `All`'s rows inline and let `DocumentList` build the
   * `Documents` scope's, so the same passport rendered with a 52px glyph column and no number
   * controls in one and a 14px column with Copy and Show in the other. Tapping a scope pill appeared
   * to redraw the row. `documentRowProps.ts` is now the only builder; these are the assertions that
   * keep it that way.
   */
  const WITH_NUMBER = document({
    id: 'aaaaaaa9-0000-4000-8000-000000000000',
    title: 'Aadhaar',
    identifier: '729481038109',
  })

  it('offers the same number controls under All as under Documents', async () => {
    const user = userEvent.setup()
    stubApi({ documents: [WITH_NUMBER], things: [SWIFT] })
    await renderAt('/library')

    await screen.findByText('Aadhaar')
    const inAll = screen
      .getAllByRole('button', { name: /Aadhaar/ })
      .map((b) => b.getAttribute('aria-label'))
    // Copy, and only Copy: ADR-0034 shows the number outright, so there is no Show beside it. The
    // assertion that matters is not which controls there are but that the two scopes agree.
    expect(inAll).toContain('Copy Aadhaar number for Aadhaar')
    expect(inAll).not.toContain('Show Aadhaar number for Aadhaar')

    await user.click(scopePills().getByRole('button', { name: 'Documents' }))
    await waitFor(() => expect(screen.queryByText('Maruti Swift')).not.toBeInTheDocument())

    const inDocuments = screen
      .getAllByRole('button', { name: /Aadhaar/ })
      .map((b) => b.getAttribute('aria-label'))
    expect(inDocuments).toEqual(inAll)
  })

  it('ADR-0034: draws the number in full, and offers no page-wide Show', async () => {
    stubApi({ documents: [WITH_NUMBER], things: [SWIFT] })
    await renderAt('/library')

    await screen.findByText('Aadhaar')
    // Grouped for reading, because it is all digits — `groupForReading`.
    expect(screen.getByText('7294 8103 8109')).toBeInTheDocument()

    /**
     * The header's reveal-everything control is gone. It answered per page a question the You
     * screen's preference answers once, and it could only ever speak for the rows already fetched.
     *
     * Matched on the accessible name, which was exactly `Show` / `Hide`: the `1234` glyph beside the
     * word is `aria-hidden`, so it never formed part of the name. Nothing else in this header is
     * called either word — the scope pills are All / Documents / Things.
     */
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hide' })).toBeNull()
    expect(screen.queryByText('•••• 8109')).toBeNull()
  })

  it('indents the title identically in both scopes', async () => {
    // The 52px glyph column, which is what lines a document's title up with a thing's thumbnail. It
    // was conditional on the scope, which is exactly the drift being prevented — so this reads the
    // class off the rendered row rather than trusting the prop.
    const user = userEvent.setup()
    stubApi({ documents: [WITH_NUMBER], things: [SWIFT] })
    const { container } = await renderAt('/library')
    await screen.findByText('Aadhaar')

    const columnIn = () => container.querySelector('[href^="/documents/"] > span')?.className ?? ''
    const inAll = columnIn()
    expect(inAll).toContain('w-[52px]')

    await user.click(scopePills().getByRole('button', { name: 'Documents' }))
    await waitFor(() => expect(screen.queryByText('Maruti Swift')).not.toBeInTheDocument())
    expect(columnIn()).toBe(inAll)
  })
})

describe('the filter chips are gone, and what replaced them', () => {
  it('draws no filter chip row in any scope', async () => {
    // Handoff 5 draws the library header as the scope pills and nothing else. The only pill group
    // left is the scope switch — a second `group` here means a chip row came back.
    const user = userEvent.setup()
    await renderAt('/library')
    await screen.findByText('Passport')

    expect(screen.getAllByRole('group')).toHaveLength(1)

    await user.click(scopePills().getByRole('button', { name: 'Documents' }))
    await waitFor(() => expect(screen.queryByText('Maruti Swift')).not.toBeInTheDocument())
    expect(screen.getAllByRole('group')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Type' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Whose' })).toBeNull()
  })

  it('still honours a filter that arrives in the URL, and offers a way out of it', async () => {
    // `?scan=no` has no chip drawing it any more, so without the Clear the list would be short for a
    // reason nothing on screen could explain OR undo. That is the failure the folded search also
    // guards against.
    const user = userEvent.setup()
    const { router } = await renderAt('/library?scope=documents&scan=no')
    await screen.findByRole('heading', { name: 'Documents' })

    const clear = await screen.findByRole('button', { name: 'Clear' })
    await user.click(clear)

    await waitFor(() => expect(router.state.location.search).toMatchObject({ scan: '' }))
  })

  it('does not draw Clear when nothing is narrowing', async () => {
    // A control that does nothing is worse than no control.
    await renderAt('/library')
    await screen.findByText('Passport')
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull()
  })
})
