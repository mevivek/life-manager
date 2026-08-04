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
  /**
   * `restoreAllMocks` does **not** undo `vi.stubGlobal`, and four tests below replace `navigator`
   * wholesale. The last of them — in `storage quota` — had no `unstubAllGlobals` of its own, so its
   * fake `navigator.storage` outlived its describe block and was still installed for `session
   * boundaries`. Harmless today, and exactly the shared mutable state conventions/testing.md §5
   * forbids: it makes the file order-dependent, which is the first thing to rule out in a flake.
   *
   * Worth knowing while you are here: `{ ...globalThis.navigator }` spreads to `{}`, because a
   * `Navigator`'s properties live on its prototype. So each of those stubs replaces `navigator` with
   * an object carrying ONLY the one field the test set — not a copy with one field changed.
   */
  vi.unstubAllGlobals()
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

/**
 * Things joined the queue after documents, and these are weighted towards the two ways a second
 * domain breaks a queue that was written for one: an entry addressed by the wrong field, and a
 * `send()` branch that falls through to the previous domain's endpoint.
 */
describe('things in the queue', () => {
  const THING_ID = '55555555-5555-4555-8555-555555555555'
  const PHOTO_ID = '66666666-6666-4666-8666-666666666666'

  /** Satisfies `thingSchema`, so the client's Zod parse succeeds and a replay can report success. */
  const thingBody = (overrides: Record<string, unknown> = {}) => ({
    id: THING_ID,
    space_id: '22222222-2222-4222-8222-222222222222',
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
    version: 1,
    ...overrides,
  })

  /** The three-step photo upload from things.md §5, recording which thing each step was addressed to. */
  function photoHandlers(steps: string[], thingIdSeen: string[], heroSeen: boolean[] = []) {
    return [
      http.post('*/api/v1/things/:id/photos\\:presign-upload', async ({ params, request }) => {
        const body = (await request.json()) as { make_hero?: boolean }
        steps.push('presign')
        thingIdSeen.push(String(params.id))
        heroSeen.push(body.make_hero ?? true)
        return HttpResponse.json({
          photo_id: PHOTO_ID,
          upload_url: 'https://storage.test/photo',
          storage_key: `spaces/s/things/${THING_ID}/${PHOTO_ID}`,
          expires_at: '2026-08-02T00:10:00.000Z',
        })
      }),
      http.put('https://storage.test/photo', () => {
        steps.push('put')
        return new HttpResponse(null, { status: 200 })
      }),
      http.post('*/api/v1/things/:id/photos\\:confirm', () => {
        steps.push('confirm')
        return HttpResponse.json({
          id: PHOTO_ID,
          thing_id: THING_ID,
          mime: 'image/jpeg',
          size_bytes: 4,
          sha256: null,
          is_hero: true,
          uploaded_at: '2026-08-02T00:00:00.000Z',
          created_at: '2026-08-02T00:00:00.000Z',
        })
      }),
    ]
  }

  it('sends a queued thing edit to the things endpoint, not the documents one', async () => {
    const outbox = await import('./outbox')
    const hit: string[] = []
    server.use(
      http.patch('*/api/v1/things/:id', () => {
        hit.push('things')
        return HttpResponse.json(thingBody({ version: 2 }))
      }),
      http.patch('*/api/v1/documents/:id', () => {
        hit.push('documents')
        return HttpResponse.json(documentBody())
      }),
    )

    await outbox.enqueue({
      kind: 'thing.update',
      thingId: THING_ID,
      patch: { version: 1, name: 'Edited in the kitchen' },
    })
    const result = await outbox.replay()

    /**
     * The assertion is `['things']` rather than "sent 1". `send()` used to end in a bare
     * `api.documents.update(entry.documentId, …)` as its implicit final branch, so a thing entry
     * would have been PATCHed to `/documents/undefined` — a request that fails, but for a reason the
     * counts alone would not distinguish from an ordinary rejection.
     */
    expect(hit).toEqual(['things'])
    expect(result.sent).toBe(1)
    expect(await outbox.list()).toHaveLength(0)
  })

  it('keeps the version precondition on a queued thing edit and surfaces a 409', async () => {
    const outbox = await import('./outbox')
    let seenVersion: number | null = null
    server.use(
      http.patch('*/api/v1/things/:id', async ({ request }) => {
        seenVersion = ((await request.json()) as { version: number }).version
        return HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Version 1 is stale.' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        )
      }),
    )

    await outbox.enqueue({
      kind: 'thing.update',
      thingId: THING_ID,
      patch: { version: 1, name: 'Edited offline' },
    })
    const result = await outbox.replay()

    // The version the form was READ at travelled with the queued write — rule 1. Without it a replay
    // is last-write-wins wearing a queue's clothes.
    expect(seenVersion).toBe(1)
    expect(result.conflicted).toBe(1)
    const [entry] = await outbox.list()
    expect(entry?.status).toBe('conflict')
  })

  it('"keep mine" re-queues a THING edit against the newer version', async () => {
    const outbox = await import('./outbox')

    const queued = await outbox.enqueue({
      kind: 'thing.update',
      thingId: THING_ID,
      patch: { version: 1, name: 'Mine' },
    })
    const before = queued.idempotencyKey

    await outbox.retryWithVersion(queued.id, 7)

    const [entry] = await outbox.list()
    /**
     * `retryWithVersion` narrowed on `kind !== 'document.update'` before things existed, so without
     * the second branch this silently did nothing and the retry was refused for the same reason again.
     */
    expect(entry?.kind === 'thing.update' && entry.patch.version).toBe(7)
    expect(entry?.status).toBe('pending')
    // A NEW logical operation, so a new key — reusing it would replay the original 409.
    expect(entry?.idempotencyKey).not.toBe(before)
  })

  it('queues a service log with the day it happened, not the day it sends', async () => {
    const outbox = await import('./outbox')
    let body: { serviced_on?: string } = {}
    server.use(
      http.post('*/api/v1/things/:id/services', async ({ request }) => {
        body = (await request.json()) as { serviced_on?: string }
        return HttpResponse.json(
          {
            id: '77777777-7777-4777-8777-777777777777',
            thing_id: THING_ID,
            serviced_on: '2026-08-02',
            cost: null,
            currency: null,
            provider: null,
            notes: null,
            created_at: '2026-08-04T00:00:00.000Z',
          },
          { status: 201 },
        )
      }),
    )

    await outbox.enqueue({
      kind: 'thing.service',
      thingId: THING_ID,
      input: { serviced_on: '2026-08-02' },
    })
    const result = await outbox.replay()

    // Logged at the garage on the 2nd, sent on the 4th, and it still records the 2nd. The date is in
    // the payload rather than derived at send time precisely so that stays true.
    expect(result.sent).toBe(1)
    expect(body.serviced_on).toBe('2026-08-02')
  })

  it('presigns a thing photo at REPLAY time and keeps its hero choice', async () => {
    const outbox = await import('./outbox')
    const steps: string[] = []
    const heroSeen: boolean[] = []
    server.use(...photoHandlers(steps, [], heroSeen))

    await outbox.enqueue({
      kind: 'thing.photo',
      thingId: THING_ID,
      blob: new Blob(['fake'], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      sizeBytes: 4,
      makeHero: false,
    })

    expect(steps).toEqual([])

    const result = await outbox.replay()

    expect(result.sent).toBe(1)
    expect(steps).toEqual(['presign', 'put', 'confirm'])
    /**
     * `false` survived the queue. The server defaults `make_hero` to TRUE and confirming a hero
     * demotes its siblings, so a photo added from the strip and replayed an hour later would
     * otherwise steal the main slot from whatever the user chose in the meantime.
     */
    expect(heroSeen).toEqual([false])
  })

  it('re-points a photo and a service at the real id once the thing is created', async () => {
    const outbox = await import('./outbox')
    const steps: string[] = []
    const thingIdSeen: string[] = []
    const serviceIdSeen: string[] = []
    server.use(
      http.post('*/api/v1/things', () => HttpResponse.json(thingBody(), { status: 201 })),
      http.post('*/api/v1/things/:id/services', ({ params }) => {
        serviceIdSeen.push(String(params.id))
        return HttpResponse.json(
          {
            id: '77777777-7777-4777-8777-777777777777',
            thing_id: THING_ID,
            serviced_on: '2026-08-02',
            cost: null,
            currency: null,
            provider: null,
            notes: null,
            created_at: '2026-08-02T00:00:00.000Z',
          },
          { status: 201 },
        )
      }),
      ...photoHandlers(steps, thingIdSeen),
    )

    // File a thing with no signal, photograph it, and log the service that prompted filing it — all
    // three queued, and the last two addressed to an id the server has never heard of.
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

    await outbox.replay()

    // Both dependants followed the create to the real id. `remapTempId` rewrites `thingId` here where
    // it rewrites `documentId` for a document — the two fields are deliberately NOT merged, because
    // renaming one would orphan every entry already queued by an installed bundle.
    expect(thingIdSeen).toEqual([THING_ID])
    expect(serviceIdSeen).toEqual([THING_ID])
    expect(await outbox.list()).toHaveLength(0)
  })

  it('does not let a queued THING create remap a document’s temp id', async () => {
    const outbox = await import('./outbox')
    const documentIdSeen: string[] = []
    server.use(
      http.post('*/api/v1/things', () => HttpResponse.json(thingBody(), { status: 201 })),
      http.post('*/api/v1/documents/:id/files\\:presign-upload', ({ params }) => {
        documentIdSeen.push(String(params.id))
        return HttpResponse.error()
      }),
    )

    /**
     * A thing and a document queued under the SAME temporary id — contrived, but it is the exact
     * collision a shared `subjectId` field would have made possible, and the reason `remapTempId`
     * takes a subject rather than matching on the id alone.
     */
    await outbox.enqueue({
      kind: 'thing.create',
      tempId: 'temp-shared',
      input: { name: 'Dishwasher', kind: 'appliance' },
    })
    await outbox.enqueue({
      kind: 'file.upload',
      documentId: 'temp-shared',
      blob: new Blob(['fake'], { type: 'image/jpeg' }),
      mime: 'image/jpeg',
      sizeBytes: 4,
    })

    await outbox.replay()

    // The document's upload still points at its own placeholder: a thing's create must not claim it.
    expect(documentIdSeen).toEqual(['temp-shared'])
  })

  it('does not queue a thing delete, a photo delete, or a hero promotion', async () => {
    const { api, OfflineError } = await import('./api')
    const outbox = await import('./outbox')
    server.use(
      http.delete('*/api/v1/things/:id', () => HttpResponse.error()),
      http.delete('*/api/v1/things/:id/photos/:photoId', () => HttpResponse.error()),
      http.patch('*/api/v1/things/:id/photos/:photoId', () => HttpResponse.error()),
    )

    await expect(api.things.remove(THING_ID, 1)).rejects.toBeInstanceOf(OfflineError)
    await expect(api.things.photos.remove(THING_ID, PHOTO_ID)).rejects.toBeInstanceOf(OfflineError)
    await expect(api.things.photos.makeHero(THING_ID, PHOTO_ID)).rejects.toBeInstanceOf(
      OfflineError,
    )

    /**
     * All three stay out by choice. The delete for documents' reason — nothing to re-apply when it
     * comes back as a conflict — and the two photo verbs because they are decisions about a set the
     * user is looking at, which must not be replayed against a set that has since changed.
     */
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
