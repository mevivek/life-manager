import { hashKey } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

/** The device's IndexedDB, as far as `lib/persister.ts` is concerned. */
const store = new Map<string, unknown>()

/**
 * ══════════════════════════════════════════════════════════════════════════════════════
 *  Whether the page running right now is still allowed to write to `store`.
 *  Without this, one test's cache lands in a later test's IndexedDB. Debt **D76**.
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 * `lib/persister.ts` gives the shared `queryCachePersister` `throttleTime: 1_000`, and
 * `createAsyncStoragePersister` implements that with `asyncThrottle`, which keeps exactly ONE queued
 * write and runs it `throttleTime` after the previous one finished. **The persister is a module
 * singleton**, so that queue does not belong to a test — it belongs to this file. `store.clear()` in
 * `beforeEach` cannot reach it, because the write has not happened yet.
 *
 * Measured on this file with every write logged: the first mount writes at +242ms, its follow-up is
 * queued for +1242ms, and it lands at **+1266ms — four tests later** — carrying whichever dehydrated
 * cache was most recent. Four assertions here are wrong the moment that happens:
 *
 *  · both tests that assert `hardRecovery()` purged the cache see the key come straight back;
 *  · a landed write carries the CURRENT buster, so "fails fast offline" finds a usable `me` on disk,
 *    resolves the guard and never reaches the error screen;
 *  · and "discards a cache written by an older build" sees `meRequests` 0 where it requires 1.
 *
 * That is D76 exactly: two of them fail together, only under a parallel run. Load does not change
 * *what* happens — it changes *when* the queued write lands relative to the assertion, which is why
 * the file passes in isolation and why no timeout would fix it.
 *
 * So a write from a page that is gone is **dropped**, which is what a browser does for free: it tears
 * the page down with the timer still inside it. `del` is deliberately NOT guarded — a purge must
 * always be observable, since it is the thing two of these tests are about.
 *
 * The app's own version of this hazard is real, and it is handled rather than hidden here:
 * `lib/session.ts` clears the query client *before* deleting the file, "so that if the persister's
 * throttled write lands after the delete below, the only thing it can possibly write is an empty
 * cache".
 */
let pageMayPersist = false

vi.mock('idb-keyval', () => ({
  get: async (key: string) => store.get(key),
  set: async (key: string, value: unknown) => {
    if (!pageMayPersist) return
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
function seedPersistedCache(
  buster: string,
  /**
   * Overridable so one test can seed a cache that is VALID (the buster matches, so the persister
   * restores it and leaves the file on disk) yet does not satisfy the route guard — which is how the
   * error boundary can be reached with a real cache still sitting in IndexedDB to be purged.
   */
  queries: ReturnType<typeof persistedQuery>[] = [
    persistedQuery(['me'], CACHED_ME),
    persistedQuery(LEDGER_KEY, { data: [CACHED_DOCUMENT], next_cursor: null }),
  ],
): void {
  store.set(
    CACHE_KEY,
    JSON.stringify({
      buster,
      timestamp: Date.now(),
      clientState: { mutations: [], queries },
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

  // From here until this page goes away, the persister's writes are the live page's and count.
  pageMayPersist = true

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

/**
 * A fake Cache Storage and a fake service-worker container, plus a `location` whose only difference
 * from the real one is that `reload` is observable.
 *
 * jsdom provides none of the three: `caches` and `navigator.serviceWorker` simply do not exist, and
 * `location.reload` is non-configurable so it cannot be spied. The `Proxy` swaps exactly one property
 * and forwards everything else to the real `Location`, so nothing else in the environment — MSW,
 * testing-library, the router — notices the substitution.
 */
type RecoveryEnvironment = {
  cacheNames: string[]
  unregistered: number
  reloads: number
}

function fakeRecoveryEnvironment(cacheNames: string[]): RecoveryEnvironment {
  const environment: RecoveryEnvironment = {
    cacheNames: [...cacheNames],
    unregistered: 0,
    reloads: 0,
  }

  vi.stubGlobal('caches', {
    keys: async () => [...environment.cacheNames],
    delete: async (name: string) => {
      const before = environment.cacheNames.length
      environment.cacheNames = environment.cacheNames.filter((each) => each !== name)
      return environment.cacheNames.length < before
    },
  })

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      getRegistrations: async () => [
        {
          unregister: async () => {
            environment.unregistered += 1
            return true
          },
        },
      ],
    },
  })

  /**
   * A plain stand-in rather than a `Proxy` over the real `Location`. A proxy cannot lie about
   * `reload`: it is a non-configurable, non-writable data property on the target, and returning
   * anything else from the `get` trap violates a proxy invariant and throws. So the fields the
   * environment actually reads are copied across and only `reload` differs.
   */
  const { href, origin, protocol, host, hostname, port, pathname, search, hash } = window.location
  vi.stubGlobal('location', {
    href,
    origin,
    protocol,
    host,
    hostname,
    port,
    pathname,
    search,
    hash,
    toString: () => href,
    assign: () => {},
    replace: () => {},
    reload: () => {
      environment.reloads += 1
      /**
       * A reload ends this page, and the persister's queued write goes with it. jsdom keeps the
       * document alive instead, so without this line that write lands after `hardRecovery()` purged
       * the cache and puts the key straight back (**D76**). Nothing can slip in between the purge and
       * here: `hardRecovery`'s remaining steps all settle on microtasks, and a timer only runs at a
       * macrotask boundary.
       */
      pageMayPersist = false
    },
  })

  return environment
}

/**
 * The loop guard's key, hand-written rather than imported — the same reasoning as `LEDGER_KEY` above.
 * The key is part of what is being asserted: importing the constant would let a rename that breaks the
 * guard's lifetime (say, to a `localStorage` key) slip through green.
 */
const RECOVERY_KEY = 'life-manager-stale-client-recovery'

/** Fires the event Vite dispatches on `window` when a dynamic import or its preload fails. */
function dispatchPreloadError(): Event {
  const event = new Event('vite:preloadError', { cancelable: true })
  // The `payload` Vite attaches. `Object.assign` because `Event` has no such field in the DOM types.
  Object.assign(event, { payload: new Error('Failed to fetch dynamically imported module') })
  window.dispatchEvent(event)
  return event
}

/**
 * Lets `hardRecovery()`'s three awaited steps settle.
 *
 * A macrotask turn rather than a fixed number of microtask ticks: one turn drains the whole microtask
 * queue, so it cannot be off by one as the number of `await`s changes. And unlike `vi.waitFor` it can
 * establish that a reload did **not** happen, which half of these assertions need.
 */
async function settleRecovery(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  store.clear()
  // Nothing is mounted yet, so nothing may write — see the block comment on `pageMayPersist`.
  pageMayPersist = false
  window.sessionStorage.clear()
})

afterEach(async () => {
  const { onlineManager } = await import('@tanstack/react-query')
  onlineManager.setOnline(true)
  // The page this test mounted is gone. Anything the shared persister still has queued for it must
  // not land in the next test's IndexedDB (D76).
  pageMayPersist = false
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.sessionStorage.clear()
  // `configurable: true` above is what makes this possible; leaving it defined would let one test's
  // fake worker satisfy another test's assertions.
  Reflect.deleteProperty(navigator, 'serviceWorker')
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

/**
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *  Recovery from a client that is OLDER than the origin — the loop a phone was stuck in.
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *
 * Three deploys in quick succession left an installed PWA holding an `index.html` from the first,
 * naming `/assets/_authed-B5PBI_a-.js`, which no longer existed. The origin's SPA fallback answered
 * that path with the app's own HTML at status 200, so the browser refused to execute it as a module
 * and the root error boundary offered a **Reload** that fetched the same precached HTML and asked for
 * the same dead chunk.
 *
 * These live beside the D49 tests above because they are the same class of defect — the app's cold
 * start, wrong in a way no feature test can see — and because both fixes are one `location.reload()`
 * away from being silently undone.
 */
describe('recovering from a stale client', () => {
  it('recovers once per tab, and refuses to reload a second time', async () => {
    const environment = fakeRecoveryEnvironment(['workbox-precache-v2-https://app.mevivek.dev/'])
    store.set(CACHE_KEY, 'a cache written by the build that is now stale')

    const { installStaleChunkRecovery } = await import('./recovery')
    const uninstall = installStaleChunkRecovery()

    const first = dispatchPreloadError()
    await settleRecovery()

    // Vite rethrows the error only `if (!e.defaultPrevented)`, so this is what stops a second,
    // more confusing message appearing in the moment before the page goes away.
    expect(first.defaultPrevented).toBe(true)
    expect(environment.reloads).toBe(1)
    expect(environment.unregistered).toBe(1)
    expect(environment.cacheNames).toEqual([])
    expect(store.has(CACHE_KEY)).toBe(false)

    /**
     * The guard must survive a reload and must NOT survive the tab. Asserting both keys, because
     * `localStorage` would leave a device that hit one bad deploy unable to attempt recovery for good.
     */
    expect(window.sessionStorage.getItem(RECOVERY_KEY)).not.toBeNull()
    expect(window.localStorage.getItem(RECOVERY_KEY)).toBeNull()

    // The page after the reload: module state is gone, so re-install — but `sessionStorage` is not.
    uninstall()
    const uninstallAfterReload = installStaleChunkRecovery()
    store.set(CACHE_KEY, 'a cache written by the build that reloaded')

    const second = dispatchPreloadError()
    await settleRecovery()

    // Still 1. A genuinely broken deploy gets an error message, not an endless reload on a phone.
    expect(environment.reloads).toBe(1)
    // And this time the error is deliberately NOT suppressed: it has to reach the error boundary,
    // which is where the user is offered a Reload that performs the same recovery on purpose.
    expect(second.defaultPrevented).toBe(false)
    expect(store.has(CACHE_KEY)).toBe(true)

    uninstallAfterReload()
  })

  it('suppresses the extra events one failed import fires, without reloading twice', async () => {
    const environment = fakeRecoveryEnvironment([])
    const { installStaleChunkRecovery } = await import('./recovery')
    const uninstall = installStaleChunkRecovery()

    // Vite reports every rejected preload dependency and then the module load itself, so more than
    // one event per failure is normal.
    const first = dispatchPreloadError()
    const second = dispatchPreloadError()
    await settleRecovery()

    expect(first.defaultPrevented).toBe(true)
    expect(second.defaultPrevented).toBe(true)
    expect(environment.reloads).toBe(1)

    uninstall()
  })

  it('does not auto-reload at all when the loop guard cannot be written', async () => {
    const environment = fakeRecoveryEnvironment([])
    /**
     * `Storage.prototype`, not the `sessionStorage` instance. jsdom implements a `Storage` as an
     * exotic object with a named-property handler, so an own `setItem` defined on the instance is not
     * the property a caller reaches — the spy appears to install and then does nothing, which made an
     * earlier draft of this test pass a recovery it was asserting had been declined.
     */
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is disabled')
    })

    const { installStaleChunkRecovery } = await import('./recovery')
    const uninstall = installStaleChunkRecovery()

    const event = dispatchPreloadError()
    await settleRecovery()

    /**
     * With no durable guard there is nothing to stop a loop, so the automatic path declines and the
     * error surfaces instead. The Reload button still works — a tap is one decision per tap.
     */
    expect(environment.reloads).toBe(0)
    expect(event.defaultPrevented).toBe(false)

    uninstall()
  })

  it("the error boundary's Reload does the hard recovery, not a bare location.reload()", async () => {
    const { cacheBuster } = await import('./persister')
    /**
     * A cache whose buster MATCHES — so the persister restores it and leaves the file on disk — but
     * which has no `me` entry, so `_authed`'s guard still has to go to the network. Offline, that
     * fails and lands on the error boundary with a real persisted cache still there to be purged.
     */
    seedPersistedCache(cacheBuster, [
      persistedQuery(LEDGER_KEY, { data: [CACHED_DOCUMENT], next_cursor: null }),
    ])
    stubTheRestOfTheNowScreen()
    const environment = fakeRecoveryEnvironment(['workbox-precache-v2-https://app.mevivek.dev/'])
    await goOffline()

    await mountApp()

    expect(await screen.findByText('Something went wrong.')).toBeInTheDocument()
    expect(store.has(CACHE_KEY)).toBe(true)

    await userEvent.setup().click(screen.getByRole('button', { name: 'Reload' }))
    await settleRecovery()

    /**
     * A plain reload would score `reloads: 1` and nothing else — which is exactly the button that
     * could not escape the loop. The other three are what make the label honest.
     */
    expect(environment.unregistered).toBe(1)
    expect(environment.cacheNames).toEqual([])
    expect(store.has(CACHE_KEY)).toBe(false)
    expect(environment.reloads).toBe(1)
  })
})

/**
 * A config assertion, and a cheap one. `navigateFallbackDenylist` is a line in `vite.config.ts` that
 * no test could previously see, which is how a denylist entry gets deleted by a session tidying up.
 *
 * Asserted by MATCHING REAL PATHS rather than comparing regex sources: what matters is which requests
 * the service worker is allowed to answer with `index.html`, and a `/^\/assets\//` that had been
 * mistyped would still compare equal to itself.
 */
describe('the service worker navigation denylist', () => {
  it('excludes the API and the hashed assets, and still allows a deep link', async () => {
    const { NAVIGATE_FALLBACK_DENYLIST } = await import('./sw-routing')
    // Workbox tests these against `url.pathname + url.search`, so that is what is fed in here.
    const denied = (pathname: string) =>
      NAVIGATE_FALLBACK_DENYLIST.some((pattern) => pattern.test(pathname))

    expect(denied('/api/v1/me')).toBe(true)
    expect(denied('/assets/_authed-B5PBI_a-.js')).toBe(true)
    expect(denied('/assets/index-abc123.css')).toBe(true)

    // The fallback's whole purpose: a client-side route with no file behind it must still get the
    // shell, or a hard refresh on a document is a 404.
    expect(denied('/documents/00000001-0000-4000-8000-000000000000')).toBe(false)
    expect(denied('/home')).toBe(false)
    expect(denied('/outbox')).toBe(false)
  })
})
