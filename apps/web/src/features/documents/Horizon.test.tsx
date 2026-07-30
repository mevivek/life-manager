import type { Document, Thing } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { NowPage } from '@/routes/_authed/home'
import { server } from '@/test/msw'
import { AddSheetProvider } from './AddSheetProvider'
import { expiryOf } from './ExpiryStatus'
import { Horizon } from './Horizon'
import { buildHorizon, type HorizonEntry } from './useLedger'

/**
 * The horizon, now that it is cross-domain. ADR-0029, design.md §8.
 *
 * Three things are worth testing here and nowhere else:
 *
 *  1. **The two-branch empty state.** A previous session collapsed it into one
 *     `if (rows.length === 0) return null` and shipped a blank half-screen, reported from a real phone.
 *  2. **Shape, not a section header.** A thing event is a square dot with a mono kicker; a document is
 *     a round dot with none. If someone "tidies" that into two lists, the Now screen loses the one
 *     property it has (ADR-0025 §4).
 *  3. **The Now screen surviving a failing Things request.** There is no Things API yet (things.md
 *     §10), so this is not a hypothetical — it is production today, on the app's home screen.
 *
 * The merge arithmetic itself is unit-tested in `useLedger.test.ts`, which needs no DOM.
 */

/** A fixed "today" so every relative assertion is arithmetic rather than a race with the clock. */
const TODAY = new Date('2026-07-29T12:00:00.000Z')

function iso(days: number): string {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function doc(overrides: Partial<Document> & { id: string; title: string }): Document {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
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
    ...overrides,
  }
}

function thing(overrides: Partial<Thing> & { id: string; name: string }): Thing {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
    kind: 'appliance',
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
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function entriesFor(documents: Document[], things: Thing[]): HorizonEntry[] {
  return buildHorizon(
    documents.map((document) => ({ document, expiry: expiryOf(document.expires_on, TODAY) })),
    things,
    TODAY,
  )
}

/**
 * A router around the component, so `<Link>` resolves. Both domains' detail paths are declared, because
 * a thing entry links to `/things/$thingId` and a missing route makes `<Link>` throw rather than render.
 */
async function renderWithRouter(ui: React.ReactElement) {
  const rootRoute = createRootRoute({ component: () => ui })
  const documentDetail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents/$documentId',
    component: () => null,
  })
  const thingDetail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/things/$thingId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([documentDetail, thingDetail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  // `RouterProvider` renders nothing until the first match resolves, so awaiting `load()` is what makes
  // everything after it synchronous rather than a pile of `waitFor`s.
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

describe('the horizon with no entries', () => {
  it('states that nothing else is dated when every dated document is already urgent', () => {
    // The reported case: one passport expiring in 6 days, so the timeline is empty while
    // `datedDocuments` is 1.
    render(<Horizon entries={[]} datedDocuments={1} complete={true} />)
    expect(screen.getByText(/nothing else has a date we watch\./i)).toBeInTheDocument()
    expect(screen.getByText(/the horizon/i)).toBeInTheDocument()
  })

  it('renders nothing when nothing anywhere holds a forward date, because the headline says it', () => {
    // Reaching this branch already proves there is no forward THING event either — one would have put
    // an entry in the list. So "the headline already said it" is still the whole justification.
    const { container } = render(<Horizon entries={[]} datedDocuments={0} complete={true} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not claim a total it cannot know when something could not be loaded', () => {
    render(<Horizon entries={[]} datedDocuments={2} complete={false} />)
    expect(
      screen.getByText(/nothing else has a date we watch in what we could load\./i),
    ).toBeInTheDocument()
  })

  it('still draws the timeline when a THING has a date and no document does', async () => {
    // The case a second domain creates and the old single-domain logic would have swallowed: zero dated
    // documents, one warranty ahead. This is NOT an empty state, and the branch above must not claim it
    // — which is why the condition is `entries.length === 0` and not a document count.
    await renderWithRouter(
      <Horizon
        entries={entriesFor(
          [],
          [thing({ id: 'boiler', name: 'Boiler', warranty_ends_on: iso(200) })],
        )}
        datedDocuments={0}
        complete={true}
      />,
    )
    expect(screen.getByText('Boiler')).toBeInTheDocument()
    expect(screen.getByText('Warranty ends')).toBeInTheDocument()
    expect(screen.queryByText(/nothing else has a date/i)).toBeNull()
  })
})

describe('the horizon as one cross-domain timeline', () => {
  it('interleaves both domains, and only the thing event carries a kicker', async () => {
    await renderWithRouter(
      <Horizon
        entries={entriesFor(
          [doc({ id: 'd1', title: 'Passport', expires_on: iso(200) })],
          [thing({ id: 't1', name: 'Boiler', warranty_ends_on: iso(100) })],
        )}
        datedDocuments={1}
        complete={true}
      />,
    )

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(2)
    // Date order across the two domains, not domain order: the boiler is sooner, so it is first.
    expect(items[0]).toHaveTextContent('Boiler')
    expect(items[1]).toHaveTextContent('Passport')

    // One kicker in the whole list, and it is on the thing. A kicker on the document too would make the
    // two kinds symmetric and the shape difference stop meaning anything.
    expect(screen.getByText('Warranty ends')).toBeInTheDocument()
    expect(items[1]).not.toHaveTextContent('Warranty')
    expect(items[1]).not.toHaveTextContent('Service')
  })

  it('draws a ROUND dot for a document and a SQUARE one for a thing', async () => {
    const { container } = await renderWithRouter(
      <Horizon
        entries={entriesFor(
          [doc({ id: 'd1', title: 'Passport', expires_on: iso(100) })],
          [thing({ id: 't1', name: 'Boiler', warranty_ends_on: iso(200) })],
        )}
        datedDocuments={1}
        complete={true}
      />,
    )

    /**
     * Asserted on the CLASS, which is unusual here and deliberate.
     *
     * The dot is the entire cross-domain distinction (design.md §8) and it is `aria-hidden`, so there is
     * no accessible name to read it off — the accessible name says the state in words instead, and that
     * is asserted in `useLedger.test.ts`. A test that only checked the words would pass with both dots
     * round, which is exactly the regression this exists for. There is no visual regression testing
     * (debt D43), so this is the closest a suite can get.
     */
    const dots = Array.from(container.querySelectorAll('span[aria-hidden="true"].size-\\[9px\\]'))
    expect(dots).toHaveLength(2)
    expect(dots[0]?.className).toContain('rounded-full')
    expect(dots[1]?.className).not.toContain('rounded-full')
  })

  it('sends each entry to its own domain’s screen', async () => {
    await renderWithRouter(
      <Horizon
        entries={entriesFor(
          [
            doc({
              id: '00000001-0000-4000-8000-000000000000',
              title: 'Passport',
              expires_on: iso(100),
            }),
          ],
          [
            thing({
              id: '00000002-0000-4000-8000-000000000000',
              name: 'Boiler',
              warranty_ends_on: iso(200),
            }),
          ],
        )}
        datedDocuments={1}
        complete={true}
      />,
    )

    const links = screen.getAllByRole('link')
    expect(links[0]).toHaveAttribute('href', '/documents/00000001-0000-4000-8000-000000000000')
    expect(links[1]).toHaveAttribute('href', '/things/00000002-0000-4000-8000-000000000000')
  })

  it('counts what is off the end of the list, not what is in one domain', async () => {
    /**
     * The arithmetic bug this locks out.
     *
     * Six entries with four shown must say "2 more" — and the old footer computed
     * `datedDocuments - shown.length`, which here would say `2 - 4 = -2` and print nothing at all while
     * four dates sat off the bottom of the list. Counting the list against itself cannot drift, whatever
     * joins it.
     *
     * `datedDocuments` is deliberately passed as the honest DOCUMENT count (2), not as a total, so a
     * regression to the old formula fails rather than coincidentally agreeing.
     */
    await renderWithRouter(
      <Horizon
        entries={entriesFor(
          [
            doc({ id: 'd1', title: 'Passport', expires_on: iso(100) }),
            doc({ id: 'd2', title: 'Licence', expires_on: iso(120) }),
          ],
          [
            thing({ id: 't1', name: 'Boiler', warranty_ends_on: iso(140) }),
            thing({ id: 't2', name: 'Fridge', warranty_ends_on: iso(160) }),
            thing({ id: 't3', name: 'Laptop', warranty_ends_on: iso(180) }),
            thing({ id: 't4', name: 'Drill', warranty_ends_on: iso(200) }),
          ],
        )}
        datedDocuments={2}
        complete={true}
      />,
    )

    // Four rows at the narrow width (jsdom's `matchMedia` reports no match, so `horizonCount()` is 4).
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('2 more dates further out.')).toBeInTheDocument()
    expect(screen.getByText('next 4')).toBeInTheDocument()
  })

  it('says "date" rather than "document", because the list holds two kinds of thing', async () => {
    await renderWithRouter(
      <Horizon
        entries={entriesFor(
          [
            doc({ id: 'd1', title: 'A', expires_on: iso(100) }),
            doc({ id: 'd2', title: 'B', expires_on: iso(110) }),
            doc({ id: 'd3', title: 'C', expires_on: iso(120) }),
            doc({ id: 'd4', title: 'D', expires_on: iso(130) }),
            doc({ id: 'd5', title: 'E', expires_on: iso(140) }),
          ],
          [],
        )}
        datedDocuments={5}
        complete={true}
      />,
    )
    // Singular, and domain-neutral. Naming one domain would be wrong about the other.
    expect(screen.getByText('1 more date further out.')).toBeInTheDocument()
  })

  it('will not claim "every date we hold" when a domain could not be read', async () => {
    const entries = entriesFor([doc({ id: 'd1', title: 'Passport', expires_on: iso(100) })], [])

    await renderWithRouter(<Horizon entries={entries} datedDocuments={1} complete={true} />)
    expect(screen.getByText(/that’s every date we hold\./i)).toBeInTheDocument()

    // `complete: false` now covers both "the archive spilled a page" and "a whole domain 404'd", so the
    // sentence must be true of either — "more than fits on one page" would be a fresh false claim.
    await renderWithRouter(<Horizon entries={entries} datedDocuments={1} complete={false} />)
    expect(screen.getByText(/there may be more further out\./i)).toBeInTheDocument()
  })
})

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The Now screen must survive a Things request that fails. This is the whole point.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `GET /api/v1/things` **404s in production right now** (things.md §10 — the UI shipped before the
 * API). Now is the app's home screen, so a second domain's missing endpoint must cost the document
 * horizon nothing at all: no error card, no blank screen, no missing timeline.
 */
describe('the Now screen when the Things request fails', () => {
  async function renderNow(thingsResponse: () => Response) {
    server.use(
      http.get('*/api/v1/documents', () =>
        HttpResponse.json({
          data: [
            doc({
              id: '00000001-0000-4000-8000-000000000000',
              title: 'Passport',
              expires_on: iso(200),
            }),
            doc({
              id: '00000002-0000-4000-8000-000000000000',
              title: 'Licence',
              expires_on: iso(400),
            }),
          ],
          next_cursor: null,
        }),
      ),
      http.get('*/api/v1/things', thingsResponse),
      // The push ask reads this; without a handler MSW fails the test for an unhandled request. `null`
      // is the "no VAPID key on this deployment" answer, which makes the card render nothing.
      http.get('*/api/v1/push/public-key', () => HttpResponse.json({ public_key: null })),
    )

    await renderWithRouter(
      <QueryClientProvider client={createQueryClient()}>
        <AddSheetProvider>
          <NowPage />
        </AddSheetProvider>
      </QueryClientProvider>,
    )
  }

  const notFound = () =>
    HttpResponse.json(
      {
        type: 'https://life-manager.app/problems/not-found',
        title: 'Not Found',
        status: 404,
        detail: 'Route GET:/api/v1/things not found',
      },
      { status: 404, headers: { 'content-type': 'application/problem+json' } },
    )

  it('still renders the document horizon, and shows no error', async () => {
    await renderNow(notFound)

    // The timeline is there in full. A NON-ZERO count, deliberately (debt D33): "renders without
    // throwing" is not the property under test — "renders the documents" is.
    await waitFor(() => expect(screen.getByText('Passport')).toBeInTheDocument())
    expect(screen.getByText('Licence')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    // Nothing anywhere on Now mentions the failure. A user who has not got Things yet must not meet an
    // error about it on their home screen.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/couldn’t load/i)).toBeNull()
    expect(screen.queryByText(/not found/i)).toBeNull()
  })

  it('hedges the footer rather than claiming every date, because a domain is missing', async () => {
    await renderNow(notFound)

    await waitFor(() => expect(screen.getByText('Passport')).toBeInTheDocument())
    // The one visible consequence of the failure, and it is a true sentence rather than an error.
    expect(screen.getByText(/there may be more further out\./i)).toBeInTheDocument()
    expect(screen.queryByText(/that’s every date we hold/i)).toBeNull()
  })

  it('merges the thing events in once the request DOES succeed', async () => {
    // The same screen, same handlers, one working endpoint — so this proves the degrade above is a
    // fallback rather than the merge simply never happening.
    await renderNow(() =>
      HttpResponse.json({
        data: [
          thing({
            id: '00000003-0000-4000-8000-000000000000',
            name: 'Boiler',
            warranty_ends_on: iso(100),
          }),
        ],
        next_cursor: null,
      }),
    )

    await waitFor(() => expect(screen.getByText('Boiler')).toBeInTheDocument())
    expect(screen.getByText('Warranty ends')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    // Both domains accounted for, so the confident sentence is earned.
    expect(screen.getByText(/that’s every date we hold\./i)).toBeInTheDocument()
  })
})
