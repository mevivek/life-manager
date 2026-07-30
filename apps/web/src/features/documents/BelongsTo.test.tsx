import type { DocumentDetailResponse, Thing } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { BelongsTo } from './BelongsTo'

/**
 * **Belongs to** — the document side of the `documents.thing_id` link. ADR-0029, things.md §7.
 *
 * What is actually worth asserting here is narrow and load-bearing:
 *
 *  - the write sends the version the screen was **read at** (ADR-0024's precondition, and the one thing
 *    a well-meaning "refresh first" would destroy),
 *  - the offline `{ queued: true }` branch is handled rather than mistaken for a document,
 *  - and neither the linked card nor the picker looks broken while the Things API does not exist
 *    (things.md §10) — which is production today, not a hypothetical.
 */

/** `lib/outbox.ts` persists through `idb-keyval`; jsdom has no IndexedDB. Same mock as `outbox.test.ts`. */
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

const DOC_ID = '00000001-0000-4000-8000-000000000000'
const THING_ID = '00000002-0000-4000-8000-000000000000'

/**
 * `version: 7` rather than 1, deliberately.
 *
 * The precondition assertion below asserts an exact number, and `1` is what a defaulted-or-forgotten
 * version would coincidentally be — so a fixture at 1 would pass whether the code read the version or
 * invented it.
 */
const detail = (overrides: Partial<DocumentDetailResponse> = {}): DocumentDetailResponse => ({
  id: DOC_ID,
  space_id: '22222222-2222-4222-8222-222222222222',
  title: 'Boiler warranty',
  doc_type: 'warranty',
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
  file_count: 0,
  version: 7,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  files: [],
  reminders: [],
  ...overrides,
})

const thing = (overrides: Partial<Thing> & { id: string; name: string }): Thing => ({
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
})

/**
 * A router, because the linked card is a `<Link>` to the thing's screen.
 *
 * Deliberately **not** `async`: an `async` wrapper that returns another function's promise types as a
 * nested one, and `noFloatingPromises` then reads every `await renderBelongsTo(...)` below as unhandled.
 */
function renderBelongsTo(document: DocumentDetailResponse) {
  return renderWithDocument(() => <BelongsTo document={document} />)
}

/**
 * The same router, around whatever the caller wants to render.
 *
 * Split out so one test can put a **state-holding wrapper** between the router and `BelongsTo`, which is
 * the only way to make the `document` prop change after mount — which is what a window-focus refetch of
 * `useDocument` does on the real screen.
 */
async function renderWithDocument(ui: () => React.ReactElement) {
  // One client for the whole render, not one per render pass. It used to be constructed inline in the
  // JSX below, which was harmless only because nothing re-rendered the root — a wrapper that holds state
  // does, and a fresh `QueryClient` mid-mutation would throw the mutation away.
  const queryClient = createQueryClient()
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{ui()}</QueryClientProvider>,
  })
  const thingDetail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/things/$thingId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([thingDetail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

/** A 404, which is what every Things path answers today (things.md §10). */
const notFound = () =>
  HttpResponse.json(
    {
      type: 'https://life-manager.app/problems/not-found',
      title: 'Not Found',
      status: 404,
      detail: 'Route not found',
    },
    { status: 404, headers: { 'content-type': 'application/problem+json' } },
  )

beforeEach(() => store.clear())

describe('BelongsTo, linked', () => {
  it('names the thing, its kind, and links to it', async () => {
    server.use(
      http.get(`*/api/v1/things/${THING_ID}`, () =>
        HttpResponse.json({
          ...thing({ id: THING_ID, name: 'Vaillant boiler', kind: 'appliance' }),
          photos: [],
          services: [],
          documents: [],
          reminders: [],
        }),
      ),
    )

    await renderBelongsTo(detail({ thing_id: THING_ID }))

    await waitFor(() => expect(screen.getByText('Vaillant boiler')).toBeInTheDocument())
    expect(screen.getByText('Appliance')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', `/things/${THING_ID}`)
    // No invitation once it is linked — the comp draws one or the other, never both.
    expect(screen.queryByText(/link this to something you own/i)).toBeNull()
  })

  it('still draws a working link when the thing cannot be read', async () => {
    // The state the app is actually in today. The LINK is a fact the document carries, so losing the
    // thing's name must not lose the relationship or the route to it.
    server.use(http.get(`*/api/v1/things/${THING_ID}`, notFound))

    await renderBelongsTo(detail({ thing_id: THING_ID }))

    await waitFor(() => expect(screen.getByText('Something you own')).toBeInTheDocument())
    // "Something you own", not "Unknown": the second reads as data loss, and nothing was lost.
    expect(screen.getByText(/couldn’t load its details/i)).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', `/things/${THING_ID}`)
  })
})

describe('BelongsTo, unlinked', () => {
  it('offers the invitation, and fires no Things request until it is opened', async () => {
    /**
     * `onUnhandledRequest: 'error'` in `test/setup.ts` is what makes this an assertion rather than a
     * comment: this test registers no handler for the things list at all, so ANY request to it would
     * fail here. The absence of one proves the picker's hook is unmounted until it is needed — which
     * matters because every document in the archive renders this section.
     */
    await renderBelongsTo(detail())
    expect(
      screen.getByRole('button', { name: /link this to something you own/i }),
    ).toBeInTheDocument()
  })

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  Debt D46: `thing_id` ABSENT is not `thing_id` set. `!== null` said it was.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   */
  it('treats a document cached by an older build, with `thing_id` absent, as unlinked', async () => {
    /**
     * The persisted Query cache is rehydrated **without** re-running Zod (`lib/persister.ts`), so
     * `.nullish().default(null)` in `packages/shared` does not fire on that path — a default only applies
     * when the schema RUNS. A document cached before `thing_id` existed therefore arrives with the key
     * missing, and `undefined !== null` is `true`.
     *
     * What that shipped: **"Something you own — couldn't load its details"** under *Belongs to*, on a
     * document linked to nothing, plus a `<Link>` with an undefined param. And because this test registers
     * no handler for a thing detail, `onUnhandledRequest: 'error'` means the request the broken branch
     * fires (`/api/v1/things/undefined`) would fail here too.
     */
    const { thing_id: _absent, ...stale } = detail()
    await renderBelongsTo(stale as DocumentDetailResponse)

    expect(
      screen.getByRole('button', { name: /link this to something you own/i }),
    ).toBeInTheDocument()
    // Exact, not a regex: the invitation's own label ends "…something you own", so a case-insensitive
    // pattern would match the very button that proves the fix.
    expect(screen.queryByText('Something you own')).toBeNull()
    expect(screen.queryByText(/couldn’t load its details/i)).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('sends `thing_id` with the version the screen was READ at, not a fresh one', async () => {
    const patched: { body: unknown; url: string }[] = []
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: [thing({ id: THING_ID, name: 'Vaillant boiler' })],
          next_cursor: null,
        }),
      ),
      http.patch(`*/api/v1/documents/${DOC_ID}`, async ({ request }) => {
        patched.push({ body: await request.json(), url: request.url })
        return HttpResponse.json({ ...detail({ thing_id: THING_ID }), version: 8 })
      }),
    )

    await renderBelongsTo(detail())
    await userEvent.click(screen.getByRole('button', { name: /link this to something you own/i }))
    await waitFor(() => expect(screen.getByText('Vaillant boiler')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /vaillant boiler/i }))

    await waitFor(() => expect(patched).toHaveLength(1))
    /**
     * `version: 7` — the number the form was populated from, and the whole of ADR-0024.
     *
     * Re-reading the document to "make sure the version is current" defeats the precondition entirely:
     * the server could then never tell that this screen was looking at stale data, and the link would
     * silently overwrite whatever else had changed. A fixture at `version: 1` would not have caught it.
     */
    expect(patched[0]?.body).toEqual({ thing_id: THING_ID, version: 7 })
  })

  it('keeps that version when the document advances AFTER the picker was opened', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  The test above passes against a document that never moves. This is the one that bites.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * `useDocument` inherits `refetchOnWindowFocus: true` and a 30s `staleTime`, so on a phone the
     * `document` prop is re-read constantly: open the picker, glance at something else, come back, tap.
     * If the version is read from the live prop at the moment of the tap, the write carries a number
     * nobody looked at — the server's `where version = :expected` matches, and whatever the other device
     * changed is overwritten with no 409 and nothing shown. So the precondition is taken when the picker
     * OPENS and held.
     *
     * The wrapper is what makes the prop move mid-test; on the real screen the refetch does it.
     */
    const patched: unknown[] = []
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: [thing({ id: THING_ID, name: 'Vaillant boiler' })],
          next_cursor: null,
        }),
      ),
      http.patch(`*/api/v1/documents/${DOC_ID}`, async ({ request }) => {
        patched.push(await request.json())
        return HttpResponse.json({ ...detail({ thing_id: THING_ID }), version: 12 })
      }),
    )

    function Harness() {
      const [document, setDocument] = useState(detail())
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setDocument((previous) => ({
                ...previous,
                version: 11,
                title: 'Renamed on the other device',
              }))
            }
          >
            simulate the focus refetch
          </button>
          <BelongsTo document={document} />
        </>
      )
    }

    await renderWithDocument(() => <Harness />)
    await userEvent.click(screen.getByRole('button', { name: /link this to something you own/i }))
    await waitFor(() => expect(screen.getByText('Vaillant boiler')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /simulate the focus refetch/i }))
    await userEvent.click(screen.getByRole('button', { name: /vaillant boiler/i }))

    await waitFor(() => expect(patched).toHaveLength(1))
    // `7`, the version the picker was opened at — not `11`, which arrived while it was open.
    expect(patched[0]).toEqual({ thing_id: THING_ID, version: 7 })
  })

  it('says the link is queued when the write could not reach the server', async () => {
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: [thing({ id: THING_ID, name: 'Vaillant boiler' })],
          next_cursor: null,
        }),
      ),
      // A network-level failure, so `lib/api` throws `OfflineError` and `writeOrQueue` enqueues rather
      // than rethrowing. That is the branch where `mutateAsync` resolves `{ queued: true }` instead of
      // a document — ADR-0024, and every call site has to handle it.
      http.patch(`*/api/v1/documents/${DOC_ID}`, () => HttpResponse.error()),
    )

    await renderBelongsTo(detail())
    await userEvent.click(screen.getByRole('button', { name: /link this to something you own/i }))
    await waitFor(() => expect(screen.getByText('Vaillant boiler')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /vaillant boiler/i }))

    // Said out loud, and NOT as a success: `thing_id` is still null, so the card below is still the
    // invitation. Claiming the link exists is how an offline write becomes a lie.
    await waitFor(() => expect(screen.getByText(/saved on this device/i)).toBeInTheDocument())
    expect(store.size).toBeGreaterThan(0)
  })

  it('surfaces a refused write instead of swallowing it', async () => {
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: [thing({ id: THING_ID, name: 'Vaillant boiler' })],
          next_cursor: null,
        }),
      ),
      // The precondition doing its job: the document moved on while this screen was open.
      http.patch(`*/api/v1/documents/${DOC_ID}`, () =>
        HttpResponse.json(
          {
            type: 'https://life-manager.app/problems/conflict',
            title: 'Conflict',
            status: 409,
            detail: 'This document changed somewhere else. Reopen it and try again.',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )

    await renderBelongsTo(detail())
    await userEvent.click(screen.getByRole('button', { name: /link this to something you own/i }))
    await waitFor(() => expect(screen.getByText('Vaillant boiler')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /vaillant boiler/i }))

    // Inline, never modal (design.md §6) — and never silent (security-model.md: no swallowed errors).
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/changed somewhere else/i)
  })

  it('says what happened, with a retry, when the Things list cannot be read', async () => {
    server.use(http.get('*/api/v1/things', notFound))

    await renderBelongsTo(detail())
    await userEvent.click(screen.getByRole('button', { name: /link this to something you own/i }))

    // A sentence, not a spinner. This is the first place a user meets Things from the Documents side,
    // and with no API behind it a permanent "Looking up what you own…" is how a missing endpoint looks
    // exactly like a broken app.
    await waitFor(() => expect(screen.getByText(/couldn’t load your things/i)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('tells the user to add the object first when Things is empty', async () => {
    server.use(
      http.get('*/api/v1/things', () => HttpResponse.json({ data: [], next_cursor: null })),
    )

    await renderBelongsTo(detail())
    await userEvent.click(screen.getByRole('button', { name: /link this to something you own/i }))

    // Empty is not an error, and it has an instruction rather than an apology (design.md §6).
    await waitFor(() => expect(screen.getByText(/nothing in things yet/i)).toBeInTheDocument())
  })
})
