import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/test/msw'

/**
 * The offline write queue from [ADR-0024](../../../../docs/decisions/0024-offline-writes-outbox.md).
 *
 * Weighted towards the ways a replay queue destroys data, because those are the reasons ADR-0013
 * rejected one and ADR-0024 had to argue its way past that rejection:
 *
 *  - a stale write being applied instead of refused,
 *  - a 4xx being retried forever,
 *  - the queue continuing past a network failure and losing its place,
 *  - and a delete being queued at all, which stays out of scope by choice (D41 is closed).
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

const DOC_ID = '33333333-3333-4333-8333-333333333333'

/** A minimal document body that satisfies `documentSchema`, so the client's Zod parse succeeds. */
const documentBody = (overrides: Record<string, unknown> = {}) => ({
  id: DOC_ID,
  space_id: '22222222-2222-4222-8222-222222222222',
  title: 'Passport',
  doc_type: 'identity',
  issuer: null,
  // ADR-0027 put the full value on every document response, `documentSchema` included — so a fixture
  // without it fails Zod at the fetch boundary and the replay never reports success.
  identifier: null,
  holder: null,
  relation: null,
  identifier_last4: null,
  issued_on: null,
  expires_on: null,
  country: null,
  notes: null,
  tags: [],
  custom_attrs: {},
  file_count: 0,
  created_at: '2026-07-29T00:00:00.000Z',
  updated_at: '2026-07-29T00:00:00.000Z',
  version: 1,
  ...overrides,
})

beforeEach(() => {
  store.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('queueing', () => {
  it('gives every entry a stable idempotency key and keeps the version precondition', async () => {
    const outbox = await import('./outbox')

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 4, title: 'Edited on the train' },
    })

    const [entry] = await outbox.list()
    expect(entry?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry?.status).toBe('pending')
    // Rule 1 of the file's header: the version travels with the queued write, or the replay is
    // indistinguishable from last-write-wins.
    expect(entry?.kind === 'document.update' && entry.patch.version).toBe(4)
  })

  it('replays in the order the writes were made', async () => {
    const outbox = await import('./outbox')
    const seen: string[] = []
    server.use(
      http.patch('*/api/v1/documents/:id', async ({ request }) => {
        const body = (await request.json()) as { title: string }
        seen.push(body.title)
        return HttpResponse.json(documentBody({ title: body.title, version: 2 }))
      }),
    )

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'first' },
    })
    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 2, title: 'second' },
    })

    await outbox.replay()

    // Sequential and ordered: the second edit's precondition is only correct once the first landed.
    expect(seen).toEqual(['first', 'second'])
  })
})

describe('replaying', () => {
  it('drops an entry that succeeds', async () => {
    const outbox = await import('./outbox')
    server.use(http.patch('*/api/v1/documents/:id', () => HttpResponse.json(documentBody())))

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Edited' },
    })
    const result = await outbox.replay()

    expect(result.sent).toBe(1)
    expect(await outbox.list()).toHaveLength(0)
  })

  it('marks a 409 as a conflict, keeps it, and does not retry it', async () => {
    const outbox = await import('./outbox')
    let attempts = 0
    server.use(
      http.patch('*/api/v1/documents/:id', () => {
        attempts++
        return HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'This document was changed elsewhere.',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        )
      }),
    )

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Stale edit' },
    })

    const first = await outbox.replay()
    expect(first.conflicted).toBe(1)

    const [entry] = await outbox.list()
    expect(entry?.status).toBe('conflict')
    expect(entry?.error).toContain('changed elsewhere')

    // A second run must NOT retry it. The server has judged this request; looping would produce the
    // same 409 forever and burn battery doing it. ADR-0024: conflicts are surfaced, not resolved.
    await outbox.replay()
    expect(attempts).toBe(1)
  })

  it('stops and keeps everything pending when the network dies mid-replay', async () => {
    const outbox = await import('./outbox')
    let calls = 0
    server.use(
      http.patch('*/api/v1/documents/:id', () => {
        calls++
        // First succeeds, second is a network failure.
        return calls === 1 ? HttpResponse.json(documentBody()) : HttpResponse.error()
      }),
    )

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'first' },
    })
    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 2, title: 'second' },
    })

    const result = await outbox.replay()

    expect(result.sent).toBe(1)
    expect(result.interrupted).toBe(true)

    // The survivor is still PENDING, not conflicted: losing the network is not the server's verdict,
    // and marking it a conflict would ask the user to resolve something that never got an answer.
    const remaining = await outbox.list()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.status).toBe('pending')
  })

  it('reuses one idempotency key across replay attempts', async () => {
    const outbox = await import('./outbox')
    const keys: (string | null)[] = []
    let calls = 0
    server.use(
      http.patch('*/api/v1/documents/:id', ({ request }) => {
        keys.push(request.headers.get('idempotency-key'))
        calls++
        // Network failure first, success second — the "response was lost" case.
        return calls === 1 ? HttpResponse.error() : HttpResponse.json(documentBody())
      }),
    )

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Edited' },
    })

    await outbox.replay()
    await outbox.replay()

    /**
     * The same key both times. This is what stops a replay showing a FALSE conflict: if the first
     * attempt actually reached the server and only the response was lost, the server has already
     * bumped the version, so a keyless retry would be refused with 409 against the user's own
     * successful write. With the key, it replays the stored response instead.
     */
    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
    expect(keys[0]).not.toBeNull()
  })
})

describe('a write that can never be sent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stops claiming "waiting to send" once it keeps failing while online', async () => {
    const outbox = await import('./outbox')
    // Online, but every attempt fails at the network layer — a CSP block, a CORS refusal, a DNS
    // failure. All of these reach JavaScript as a bare network error, identical to being offline.
    vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: true })
    server.use(http.patch('*/api/v1/documents/:id', () => HttpResponse.error()))

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Edited' },
    })

    await outbox.replay()
    expect((await outbox.list())[0]?.status).toBe('pending')
    await outbox.replay()
    expect((await outbox.list())[0]?.status).toBe('pending')

    // Third strike. This is the fix for a real report: a phone showing full signal, sitting under
    // "2 changes waiting to send. They will be sent when you are back online" — indefinitely,
    // because the requests were being blocked by the app's own CSP and never reached the server.
    const third = await outbox.replay()
    expect(third.conflicted).toBe(1)

    const [entry] = await outbox.list()
    expect(entry?.status).toBe('conflict')
    expect(entry?.error).toMatch(/appear to be online/)
  })

  it('does NOT count attempts made while genuinely offline', async () => {
    const outbox = await import('./outbox')
    vi.stubGlobal('navigator', { ...globalThis.navigator, onLine: false })
    server.use(http.patch('*/api/v1/documents/:id', () => HttpResponse.error()))

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Edited on a train' },
    })

    for (let i = 0; i < 5; i++) await outbox.replay()

    // Waiting is the correct behaviour with no network. Counting these would eventually condemn a
    // write for the crime of having been made in a tunnel.
    const [entry] = await outbox.list()
    expect(entry?.status).toBe('pending')
    expect(entry?.attempts ?? 0).toBe(0)
  })
})

describe('resolving a conflict', () => {
  /** Queues an edit and drives it to `status: 'conflict'` via a 409. */
  async function conflictedEntry() {
    const outbox = await import('./outbox')
    server.use(
      http.patch('*/api/v1/documents/:id', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Changed elsewhere.' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )
    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Mine' },
    })
    await outbox.replay()
    const [entry] = await outbox.list()
    return { outbox, entry }
  }

  it('"keep mine" re-queues against the newer version with a FRESH idempotency key', async () => {
    const { outbox, entry } = await conflictedEntry()
    const originalKey = entry?.idempotencyKey

    await outbox.retryWithVersion(entry?.id ?? '', 7)

    const [retried] = await outbox.list()
    expect(retried?.status).toBe('pending')
    expect(retried?.error).toBeUndefined()
    expect(retried?.kind === 'document.update' && retried.patch.version).toBe(7)

    /**
     * A NEW key, not the old one. Reusing it would make the server replay the stored 409 response
     * rather than considering the retry — so the user's "keep my change" would appear to fail for the
     * same reason they just resolved.
     */
    expect(retried?.idempotencyKey).not.toBe(originalKey)
  })

  it('"discard mine" removes the entry entirely', async () => {
    const { outbox, entry } = await conflictedEntry()

    await outbox.remove(entry?.id ?? '')

    expect(await outbox.list()).toHaveLength(0)
  })

  it('notifies subscribers so the banner cannot go stale', async () => {
    const outbox = await import('./outbox')
    const listener = vi.fn()
    const unsubscribe = outbox.subscribe(listener)

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'x' },
    })

    // The queue lives in IndexedDB, so without this nothing re-renders and a conflict stays
    // invisible — which is indistinguishable from having silently lost the edit.
    expect(listener).toHaveBeenCalled()
    unsubscribe()
  })
})

describe('what must not be queued', () => {
  it('a delete offline fails instead of queueing', async () => {
    const { api, OfflineError } = await import('./api')
    const outbox = await import('./outbox')
    server.use(http.delete('*/api/v1/documents/:id', () => HttpResponse.error()))

    // `useDeleteDocument` calls the API directly with no `writeOrQueue` wrapper, so this surfaces.
    await expect(api.documents.remove(DOC_ID, 1)).rejects.toBeInstanceOf(OfflineError)

    /**
     * The queue stays empty, and that is the assertion that matters. With D41 closed a queued delete
     * would now be *safe* — it carries a version and would be refused with 409 rather than destroying
     * a newer edit — but it is deliberately still not queued, because a delete that conflicts hours
     * later has nothing to re-apply and is hard to explain. This test pins that choice so enabling it
     * has to be deliberate.
     */
    expect(await outbox.list()).toHaveLength(0)
  })
})

describe('offline image capture', () => {
  const FILE_ID = '44444444-4444-4444-8444-444444444444'

  /** Handlers for the three-step ADR-0008 upload, recording which steps were reached. */
  function uploadHandlers(steps: string[], documentIdSeen: string[]) {
    return [
      http.post('*/api/v1/documents/:id/files\\:presign-upload', ({ params }) => {
        steps.push('presign')
        documentIdSeen.push(String(params.id))
        // Must match `presignUploadResponseSchema` exactly — the client parses it, so a mock that
        // drifts from the contract fails the test rather than passing a lie through (ADR-0004).
        return HttpResponse.json({
          file_id: FILE_ID,
          upload_url: 'https://storage.test/put',
          storage_key: `spaces/s/documents/${DOC_ID}/${FILE_ID}`,
          version: 1,
          expires_at: '2026-07-29T00:10:00.000Z',
        })
      }),
      http.put('https://storage.test/put', () => {
        steps.push('put')
        return new HttpResponse(null, { status: 200 })
      }),
      http.post('*/api/v1/documents/:id/files\\:confirm', () => {
        steps.push('confirm')
        return HttpResponse.json({
          id: FILE_ID,
          document_id: DOC_ID,
          version: 1,
          mime: 'image/jpeg',
          size_bytes: 4,
          sha256: '',
          is_primary: true,
          uploaded_at: '2026-07-29T00:00:00.000Z',
          created_at: '2026-07-29T00:00:00.000Z',
        })
      }),
    ]
  }

  it('presigns at REPLAY time, not at capture time', async () => {
    const outbox = await import('./outbox')
    const steps: string[] = []
    server.use(...uploadHandlers(steps, []))

    await outbox.enqueue({
      kind: 'file.upload',
      documentId: DOC_ID,
      blob: new Blob(['fake'], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      sizeBytes: 4,
    })

    // Nothing has been presigned yet — the entry holds BYTES. A URL minted at capture time would have
    // expired by the time the network returned, which is why ADR-0013 ruled out caching files at all.
    expect(steps).toEqual([])

    const result = await outbox.replay()

    expect(result.sent).toBe(1)
    expect(steps).toEqual(['presign', 'put', 'confirm'])
    expect(await outbox.list()).toHaveLength(0)
  })

  it('re-points a photo at the real id once its document is created', async () => {
    const outbox = await import('./outbox')
    const steps: string[] = []
    const documentIdSeen: string[] = []
    server.use(
      http.post('*/api/v1/documents', () => HttpResponse.json(documentBody(), { status: 201 })),
      ...uploadHandlers(steps, documentIdSeen),
    )

    // Create a document offline, then photograph it — both queued, and the photo is addressed to a
    // temporary id the server has never heard of.
    const created = await outbox.enqueue({
      kind: 'document.create',
      tempId: 'temp-abc',
      input: { title: 'Passport', doc_type: 'identity', tags: [], custom_attrs: {} },
    })
    expect(created.kind).toBe('document.create')

    await outbox.enqueue({
      kind: 'file.upload',
      documentId: 'temp-abc',
      blob: new Blob(['fake'], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      sizeBytes: 4,
    })

    await outbox.replay()

    /**
     * The upload went to the REAL id, not `temp-abc`. Without the remap this presign would 404 and
     * surface as a conflict the user could not possibly resolve — and "capture a document and its
     * photo with no signal" is the exact use case ADR-0024 was reopened for.
     */
    expect(documentIdSeen).toEqual([DOC_ID])
    expect(await outbox.list()).toHaveLength(0)
  })
})

describe('storage quota', () => {
  it('refuses to queue when free space cannot be determined', async () => {
    const { canQueueBytes } = await import('./storage-quota')
    // jsdom provides no navigator.storage, which is the same situation as a browser that does not
    // implement it.
    const check = await canQueueBytes(5 * 1024 * 1024)

    // Refuses rather than guesses. ADR-0024: "accepting one and losing it is a bug of the worst
    // category this ADR is trying to avoid."
    expect(check.ok).toBe(false)
  })

  it('refuses when free space is less than twice the file', async () => {
    const { canQueueBytes } = await import('./storage-quota')
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: {
        estimate: async () => ({ quota: 10_000_000, usage: 9_000_000 }),
        persisted: async () => true,
      },
    })

    // 1 MB free, 800 KB file — fits, but not with the 2x headroom that covers estimate() being
    // deliberately coarse and the bytes being briefly held twice during the structured clone.
    const check = await canQueueBytes(800_000)

    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toContain('Not enough free space')
  })

  it('allows a queue with room to spare', async () => {
    const { canQueueBytes } = await import('./storage-quota')
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      storage: {
        estimate: async () => ({ quota: 500_000_000, usage: 1_000_000 }),
        persisted: async () => true,
      },
    })

    const check = await canQueueBytes(3 * 1024 * 1024)

    expect(check.ok).toBe(true)
  })
})

describe('session boundaries', () => {
  it('discards queued writes on sign-out', async () => {
    vi.doMock('./auth-client', () => ({ signOut: vi.fn(async () => undefined) }))
    const outbox = await import('./outbox')
    const { endSession } = await import('./session')
    const { QueryClient } = await import('@tanstack/react-query')

    await outbox.enqueue({
      kind: 'document.update',
      documentId: DOC_ID,
      patch: { version: 1, title: 'Queued by the previous user' },
    })

    await endSession(new QueryClient())

    // A pending write belongs to the session that made it. Replaying it under the next user's
    // session would be wrong at best and cross-tenant at worst.
    expect(await outbox.list()).toHaveLength(0)
  })
})
