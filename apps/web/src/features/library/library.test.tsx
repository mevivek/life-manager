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
    identifier_last4: null,
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
    serial_last4: null,
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
