import { onlineManager, QueryClient } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/msw'

/**
 * The offline read cache from [ADR-0013](../../../../docs/decisions/0013-read-only-offline-v1.md).
 *
 * These tests are weighted towards the two things the ADR calls dangerous rather than towards the
 * happy path, because the happy path is visible the first time you open the app offline and the
 * dangerous parts are silent:
 *
 *  - a write being QUEUED while offline instead of failing, and
 *  - a previous user's cache surviving on disk across a sign-out.
 *
 * `idb-keyval` is mocked because jsdom ships no IndexedDB. That is a deliberate boundary: what is
 * worth asserting is that we delete the right key at the right moments, not that IndexedDB works.
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

vi.mock('./auth-client', () => ({ signOut: vi.fn(async () => undefined) }))

beforeEach(() => {
  store.clear()
  onlineManager.setOnline(true)
})

afterEach(() => {
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

describe('what may be written to disk', () => {
  it('persists the allowlisted query roots and nothing else', async () => {
    const { dehydrateOptions } = await import('./persister')
    const persisted = (key: readonly unknown[]) =>
      dehydrateOptions.shouldDehydrateQuery({ queryKey: key, state: { status: 'success' } })

    expect(persisted(['documents', 'list', {}])).toBe(true)
    // ADR-0029's second domain. Allowlisted deliberately, and it widens debt D47 — a thing's serial
    // is plaintext on the wire and therefore plaintext on disk, same as a document's identifier.
    expect(persisted(['things', 'list', {}])).toBe(true)
    expect(persisted(['reminders'])).toBe(true)
    // Load-bearing: routes/_authed.tsx guards on `me`, so without it an offline cold start lands on
    // the error screen and every other cached query is unreachable.
    expect(persisted(['me'])).toBe(true)

    // The allowlist is the point. A future hook must be added deliberately, not inherited.
    expect(persisted(['secrets'])).toBe(false)
    expect(persisted(['vault', 'items'])).toBe(false)
  })

  it('does not persist a failed query', async () => {
    const { dehydrateOptions } = await import('./persister')

    // A persisted error would be rehydrated and replayed as a hard failure on next launch —
    // offline, with no way for the user to retry past it.
    expect(
      dehydrateOptions.shouldDehydrateQuery({
        queryKey: ['documents', 'list', {}],
        state: { status: 'error' },
      }),
    ).toBe(false)
  })

  it('never persists a mutation, which is what stops an offline write queue forming', async () => {
    const { dehydrateOptions } = await import('./persister')

    // ADR-0013: "a queued write that appears to succeed and then loses data is worse than a write
    // that plainly failed". A dehydrated paused mutation IS that queue, so the answer is always no.
    expect(dehydrateOptions.shouldDehydrateMutation()).toBe(false)
  })
})

describe('mutations while offline', () => {
  /** Runs one mutation against `client` and reports whether the mutation function was reached. */
  async function attemptMutation(client: QueryClient): Promise<{ called: boolean }> {
    const mutationFn = vi.fn(async () => 'ok')
    const mutation = client.getMutationCache().build(client, { mutationFn })

    // Rejects offline (networkMode 'always'), or hangs paused (default 'online'). Race it against a
    // timer so the paused case cannot stall the suite.
    await Promise.race([
      mutation.execute(undefined).catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 50)),
    ])

    return { called: mutationFn.mock.calls.length > 0 }
  }

  it('fires and fails rather than being queued for replay', async () => {
    const { createQueryClient } = await import('./query-client')
    onlineManager.setOnline(false)

    const { called } = await attemptMutation(createQueryClient())

    // Reaching the mutation function offline is the observable proof it was not paused. Its failure
    // is then surfaced to the user by OfflineError; nothing is retried on reconnect.
    expect(called).toBe(true)
  })

  it('the previous test has teeth: a default client pauses instead', async () => {
    onlineManager.setOnline(false)

    // The negative control. `networkMode` defaults to 'online', which PAUSES the mutation and
    // replays it on reconnect — the offline write queue ADR-0013 rejects. If this ever starts
    // passing `called: true`, the assertion above has stopped proving anything.
    const { called } = await attemptMutation(new QueryClient())

    expect(called).toBe(false)
  })
})

describe('network failures are translated', () => {
  it('says plainly that a write was not saved', async () => {
    const { api, OfflineError } = await import('./api')
    server.use(http.post('*/api/v1/documents', () => HttpResponse.error()))

    const error = await api.documents
      .create({ title: 'Passport', doc_type: 'identity', tags: [], custom_attrs: {} })
      .catch((e) => e)

    expect(error).toBeInstanceOf(OfflineError)
    // The user-facing wording matters here: writes are never queued, so "not saved" is a fact.
    expect((error as Error).message).toMatch(/was not saved/)
  })

  it('uses read wording for a GET, and keeps the underlying cause', async () => {
    const { api, OfflineError } = await import('./api')
    server.use(http.get('*/api/v1/me', () => HttpResponse.error()))

    const error = await api.me().catch((e) => e)

    expect(error).toBeInstanceOf(OfflineError)
    expect((error as Error).message).toMatch(/could not reach the server/)
    // security-model.md §6 forbids swallowing errors; the cause is what distinguishes DNS from TLS.
    expect((error as Error).cause).toBeDefined()
  })
})

describe('the persisted cache across a session boundary', () => {
  const CACHE_KEY = 'life-manager-query-cache'

  it('is deleted on sign-out, not merely emptied in memory', async () => {
    const { endSession } = await import('./session')
    const client = new QueryClient()
    store.set(CACHE_KEY, 'a previous session worth of documents')

    await endSession(client)

    // The failure this catches: using queryClient.clear() alone, which empties memory and leaves the
    // document list on disk for the next person on a shared device (security-model.md §4).
    expect(store.has(CACHE_KEY)).toBe(false)
  })

  it('is deleted even when the sign-out request itself fails', async () => {
    const authClient = await import('./auth-client')
    vi.mocked(authClient.signOut).mockRejectedValueOnce(new Error('offline'))
    const { endSession } = await import('./session')
    const client = new QueryClient()
    store.set(CACHE_KEY, 'a previous session worth of documents')

    await expect(endSession(client)).rejects.toThrow()

    // Signing out with no connectivity must still destroy the local copy. Keeping a readable
    // document list because the network call failed is the wrong way to fail.
    expect(store.has(CACHE_KEY)).toBe(false)
  })

  it('is deleted on sign-in, covering a sign-out that never ran', async () => {
    const { beginSession } = await import('./session')
    const client = new QueryClient()
    store.set(CACHE_KEY, "another user's documents")

    await beginSession(client)

    // A tab closed mid-sign-out, or a server-side expiry, leaves the cache behind. Invalidating
    // `me` alone would refetch `me` while the document lists rendered from the restored cache.
    expect(store.has(CACHE_KEY)).toBe(false)
  })
})
