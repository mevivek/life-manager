import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { routeTree } from '@/routeTree.gen'
import { server } from '@/test/msw'

/**
 * The **Unsent changes** screen, once the outbox held two domains rather than one.
 *
 * Written because this screen had no test at all while it was the only consumer of the queue's entry
 * union — so widening that union for Things could have made every thing conflict render as a document
 * that does not exist, and nothing would have gone red. The assertions are therefore about *which
 * record a conflict is read against*, not about the copy.
 *
 * `describe()`'s exhaustive `never` default already makes a missing entry kind a compile error; what
 * it cannot catch is a kind that renders but reads the wrong endpoint, which is what these cover.
 */

const store = new Map<string, unknown>()

vi.mock('idb-keyval', () => ({
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => {
    store.set(key, structuredClone(value))
  },
  del: async (key: string) => {
    store.delete(key)
  },
}))

const SPACE = '22222222-2222-4222-8222-222222222222'
const DOC_ID = '33333333-3333-4333-8333-333333333333'
const THING_ID = '55555555-5555-4555-8555-555555555555'

const documentBody = (over: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  space_id: SPACE,
  title: 'Passport',
  doc_type: 'identity',
  issuer: null,
  identifier: null,
  thing_id: null,
  holder: null,
  relation: null,
  issued_on: null,
  expires_on: null,
  country: null,
  notes: null,
  tags: [],
  custom_attrs: {},
  file_count: 0,
  created_at: '2026-08-02T00:00:00.000Z',
  updated_at: '2026-08-02T00:00:00.000Z',
  version: 9,
  ...over,
})

const thingBody = (over: Record<string, unknown> = {}) => ({
  id: THING_ID,
  space_id: SPACE,
  name: 'Dishwasher',
  kind: 'appliance',
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
  created_at: '2026-08-02T00:00:00.000Z',
  updated_at: '2026-08-02T00:00:00.000Z',
  version: 4,
  ...over,
})

beforeEach(() => {
  store.clear()
})

async function renderOutbox() {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/outbox'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
}

describe('the unsent-changes screen', () => {
  it('reads a THING conflict against the thing, and asks the documents endpoint for nothing', async () => {
    const outbox = await import('@/lib/outbox')
    const hit: string[] = []
    server.use(
      http.get('*/api/v1/things/:id', ({ params }) => {
        hit.push(`things/${String(params.id)}`)
        return HttpResponse.json({
          ...thingBody(),
          photos: [],
          services: [],
          documents: [],
          reminders: [],
        })
      }),
      http.get('*/api/v1/documents/:id', ({ params }) => {
        hit.push(`documents/${String(params.id)}`)
        return HttpResponse.json(documentBody())
      }),
      http.patch('*/api/v1/things/:id', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Version 1 is stale.' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )

    await outbox.enqueue({
      kind: 'thing.update',
      thingId: THING_ID,
      patch: { version: 1, name: 'Renamed offline' },
    })
    // Replayed and refused, which is what puts the entry in `'conflict'` and draws the card.
    await outbox.replay()

    await renderOutbox()

    // The server's current value, read off the THING. Before the split this card called
    // `useDocument` unconditionally and would have said "This document no longer exists."
    await waitFor(() => {
      expect(screen.getByText(/Dishwasher \(version 4\)/)).toBeInTheDocument()
    })

    /**
     * And exactly one request. Calling both hooks in one component — which is what a single card with
     * two `useQuery`s would have to do, since hooks cannot be conditional — would fire a document
     * fetch for a thing's conflict on every render.
     */
    expect(hit).toEqual([`things/${THING_ID}`])
  })

  it('still reads a DOCUMENT conflict against the document', async () => {
    const outbox = await import('@/lib/outbox')
    const hit: string[] = []
    server.use(
      // `documentDetailResponseSchema` extends the document with `files` and `reminders`; a fixture
      // without them fails Zod at the fetch boundary and the card sits on "Loading…" while it retries.
      http.get('*/api/v1/documents/:id', ({ params }) => {
        hit.push(String(params.id))
        return HttpResponse.json({ ...documentBody(), files: [], reminders: [] })
      }),
      http.patch('*/api/v1/documents/:id', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Stale.' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Edited offline' },
    })
    await outbox.replay()

    await renderOutbox()

    await waitFor(() => {
      expect(screen.getByText(/Passport \(version 9\)/)).toBeInTheDocument()
    })
    expect(hit).toEqual([DOC_ID])
  })

  it('lists a queued thing, its photo and its service as waiting to send', async () => {
    const outbox = await import('@/lib/outbox')

    await outbox.enqueue({
      kind: 'thing.create',
      tempId: 'temp-thing',
      input: { name: 'Dishwasher', kind: 'appliance' },
    })
    await outbox.enqueue({
      kind: 'thing.photo',
      thingId: 'temp-thing',
      blob: new Blob(['fake'], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      sizeBytes: 4,
      makeHero: true,
    })
    await outbox.enqueue({
      kind: 'thing.service',
      thingId: 'temp-thing',
      input: { serviced_on: '2026-08-02' },
    })

    await renderOutbox()

    // Every kind describes itself. A kind with no `describe()` case throws rather than rendering
    // blank, so the failure mode this guards against is a silently empty row on the one screen whose
    // job is to say what has not been sent.
    await waitFor(() => {
      expect(screen.getByText('New thing: Dishwasher')).toBeInTheDocument()
    })
    expect(screen.getByText(/Photo waiting to upload/)).toBeInTheDocument()
    expect(screen.getByText('Service logged for 2026-08-02')).toBeInTheDocument()
  })
})
