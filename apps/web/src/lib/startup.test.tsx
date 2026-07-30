import { hashKey } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import { routeTree } from '@/routeTree.gen'
import { server } from '@/test/msw'

/**
 * **The app's cold start.** This file exists because the startup path had two bugs that every other
 * test in the suite was structurally unable to see, and one of them made the app unusable offline.
 *
 * ── What went wrong ──
 *
 * `main.tsx` mounted `RouterProvider` as a child of `PersistQueryClientProvider` and assumed the
 * provider restored the IndexedDB cache before rendering children. It does not: it renders children
 * immediately and restores in a `useEffect`. React runs a child's effects first, so the router's
 * initial load — and therefore `routes/_authed.tsx`'s `ensureQueryData(['me'])` — ran against an
 * EMPTY cache on every single launch. Online that meant waiting on the API's cold start (8825ms,
 * measured) behind a blank screen; offline it meant `networkMode: 'online'` *pausing* the fetch, so
 * `beforeLoad` awaited a promise that never settled and the app never rendered anything at all.
 *
 * ── Why these tests use the REAL route tree ──
 *
 * `offline.test.ts` already asserted that `me` is on the persist allowlist, and that assertion passed
 * throughout — because being *in the cache file* and *reaching the guard in time* are different
 * claims, and only the first was tested. A hand-rolled copy of the guard would have the same blind
 * spot: it would keep passing while `_authed.tsx` regressed. So these drive `routeTree.gen`, which
 * means an edit to the real guard, the real query options or the real provider ordering fails here.
 *
 * For the same reason the provider tree comes from `@/App` rather than being reassembled here. An
 * earlier draft of this file rebuilt the restore gate inline, which made it a test of its own copy:
 * deleting the gate from the app would have left all four of these green.
 */

const store = new Map<string, unknown>()

vi.mock('idb-keyval', () => ({
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => {
    store.set(key, value)
  },
  del: async (key: string) => {
    store.delete(key)
  },
}))

const CACHE_KEY = 'life-manager-query-cache'

const CACHED_ME = {
  user_id: '11111111-1111-4111-8111-111111111111',
  email: 'cached@example.test',
  spaces: [
    {
      space_id: '22222222-2222-4222-8222-222222222222',
      name: "Test Person's space",
      kind: 'personal',
      role: 'owner',
      joined_at: '2026-07-27T00:00:00.000Z',
    },
  ],
}

const CACHED_DOCUMENT = {
  id: '00000001-0000-4000-8000-000000000000',
  space_id: '22222222-2222-4222-8222-222222222222',
  title: 'Cached Passport',
  doc_type: 'identity',
  issuer: null,
  holder: null,
  relation: null,
  identifier: null,
  identifier_last4: null,
  issued_on: null,
  // Dated, and comfortably beyond the 45-day boundary, so it lands in the Now screen's `horizon`.
  // An UNDATED document is counted on that screen but never shows its title, so seeding one would
  // make this test assert on something the design does not render.
  expires_on: '2030-06-01',
  country: null,
  notes: null,
  tags: [],
  custom_attrs: {},
  file_count: 0,
  version: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

/**
 * The ledger's key, spelled the way `useLedger()` produces it. Hand-written rather than imported so
 * that changing the Now screen's page size or sort cannot silently make this seed miss and turn a
 * real regression into a passing test — the key is part of what is being asserted.
 */
const LEDGER_KEY = ['documents', 'list', { sort: 'expires_on', order: 'asc', limit: 100 }]

function persistedQuery(queryKey: readonly unknown[], data: unknown) {
  return {
    queryKey,
    /**
     * `hashKey`, not `JSON.stringify`. TanStack Query hashes a key with its object properties
     * SORTED, so a hand-stringified `{ sort, order, limit }` produces a different hash from the one
     * `useDocuments` will look under — the entry rehydrates into the cache and is then invisible to
     * the hook that wants it. Which is a very quiet way for this test to pass for the wrong reason.
     */
    queryHash: hashKey(queryKey),
    state: {
      data,
      dataUpdatedAt: Date.now(),
      error: null,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: false,
      status: 'success',
      fetchStatus: 'idle',
    },
  }
}

/**
 * A cache on disk exactly as a previous successful launch would have left it: the session AND the
 * archive. Seeding both matters — ADR-0013's promise is that the app is *readable* offline, so a test
 * that only seeds `me` proves the guard passed but not that anything useful is behind it.
 */
function seedPersistedCache(buster: string): void {
  store.set(
    CACHE_KEY,
    JSON.stringify({
      buster,
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          persistedQuery(['me'], CACHED_ME),
          persistedQuery(LEDGER_KEY, { data: [CACHED_DOCUMENT], next_cursor: null }),
        ],
      },
    }),
  )
}

/**
 * A genuinely dead uplink.
 *
 * `onlineManager.setOnline(false)` alone is not enough and the difference matters: it only changes
 * TanStack Query's *opinion* about connectivity, while MSW carries on answering every request
 * cheerfully. A test that flips only the flag has the guard's fetch SUCCEED, which is the opposite of
 * the situation being tested. `HttpResponse.error()` is what a real fetch rejection looks like.
 */
async function goOffline(): Promise<void> {
  const { onlineManager } = await import('@tanstack/react-query')
  server.use(http.all('*/api/v1/*', () => HttpResponse.error()))
  onlineManager.setOnline(false)
}

/**
 * The screens under `/home` fetch beyond `/me`, and `setup.ts` sets `onUnhandledRequest: 'error'`.
 * These are the rest of the Now screen's wire traffic; they are irrelevant to what is asserted, and
 * are here only so an unrelated 'error' does not masquerade as a startup failure.
 */
function stubTheRestOfTheNowScreen(): void {
  server.use(
    http.get('*/api/v1/documents/holders', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/documents', () => HttpResponse.json({ data: [], next_cursor: null })),
    http.get('*/api/v1/push/public-key', () => HttpResponse.json({ public_key: null })),
  )
}

/** Mounts the real provider tree from `@/App`, with the real route tree, at `/home`. */
async function mountApp(): Promise<void> {
  const { createQueryClient } = await import('./query-client')

  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/home'] }),
  })

  render(
    <App queryClient={queryClient}>
      {/* biome-ignore lint/suspicious/noExplicitAny: the generated tree's context is not inferable here */}
      <RouterProvider router={router as any} />
    </App>,
  )
}

beforeEach(() => {
  store.clear()
})

afterEach(async () => {
  const { onlineManager } = await import('@tanstack/react-query')
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

describe('cold start with a warm persisted cache', () => {
  it('does not go to the network for /me — the restore beats the guard', async () => {
    const { cacheBuster } = await import('./persister')
    seedPersistedCache(cacheBuster)
    stubTheRestOfTheNowScreen()

    /**
     * The assertion that actually pins the bug.
     *
     * Counting requests rather than measuring time: a slow cold start is the *symptom*, and a timing
     * assertion would be flaky. "Did the guard need the network when it already had the answer?" is
     * the same question with a deterministic answer. Before the fix this was 1.
     */
    let meRequests = 0
    server.use(
      http.get('*/api/v1/me', () => {
        meRequests += 1
        return HttpResponse.json({ ...CACHED_ME, email: 'network@example.test' })
      }),
    )

    await mountApp()

    // The guard resolved AND the cached archive is on screen, from disk, with no `/me` round trip.
    expect(await screen.findByText('Cached Passport')).toBeInTheDocument()
    expect(meRequests).toBe(0)
  })

  it('shows the cached archive offline instead of hanging on a paused fetch', async () => {
    const { cacheBuster } = await import('./persister')
    seedPersistedCache(cacheBuster)
    stubTheRestOfTheNowScreen()
    await goOffline()

    await mountApp()

    /**
     * Before the fix this rendered NOTHING — not the screen, not the error boundary. `beforeLoad`
     * awaited a query that `networkMode: 'online'` had paused, and a paused fetch never settles, so
     * there was no state for the router to move to. ADR-0013's whole promise is that this launch
     * shows the cached archive, so a blank screen here is the feature being absent.
     *
     * Asserting on the document's TITLE, not on the screen's chrome: the tab bar renders from the
     * root route and is on screen even while `_authed` is still pending, so it would pass while the
     * bug was fully present.
     */
    expect(await screen.findByText('Cached Passport')).toBeInTheDocument()
  })
})

describe('cold start with no usable cache', () => {
  it('fails fast offline rather than hanging forever', async () => {
    stubTheRestOfTheNowScreen()
    // Nothing seeded: a first-ever launch, or the first launch after a deploy changed the buster.
    await goOffline()

    await mountApp()

    /**
     * There is genuinely nothing to show, so an error screen is the correct outcome — the point is
     * that it ARRIVES. `offlineFirst` makes the fetch fail instead of pausing, which is what turns a
     * permanent blank into something with a Reload button on it (`__root.tsx`'s `RootError`).
     */
    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
  })

  it('discards a cache written by an older build rather than trusting it', async () => {
    seedPersistedCache('a-buster-from-some-previous-deploy')
    stubTheRestOfTheNowScreen()

    let meRequests = 0
    server.use(
      http.get('*/api/v1/me', () => {
        meRequests += 1
        return HttpResponse.json(CACHED_ME)
      }),
    )

    await mountApp()

    expect(await screen.findByText('Nothing in here yet.')).toBeInTheDocument()
    /**
     * The counterpart to the first test, and the reason it is not vacuous: with a stale buster the
     * guard SHOULD reach the network. Without this, a persister that silently restored nothing at
     * all would satisfy the "0 requests" assertion by never having a cache to begin with.
     */
    expect(meRequests).toBe(1)
  })
})
