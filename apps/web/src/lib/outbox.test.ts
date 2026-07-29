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
 *  - and a delete being queued at all, which is still unsafe (debt D41).
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

describe('what must not be queued', () => {
  it('a delete offline fails instead of queueing — debt D41', async () => {
    const { api, OfflineError } = await import('./api')
    const outbox = await import('./outbox')
    server.use(http.delete('*/api/v1/documents/:id', () => HttpResponse.error()))

    // `useDeleteDocument` calls the API directly with no `writeOrQueue` wrapper, so this surfaces.
    await expect(api.documents.remove(DOC_ID)).rejects.toBeInstanceOf(OfflineError)

    /**
     * The queue stays empty, and that is the assertion that matters. `DELETE` has no version
     * precondition (D41), so a queued delete replayed after the document was edited elsewhere would
     * destroy that edit with no conflict shown — the precise failure ADR-0024 exists to prevent.
     * If a future change starts queueing deletes, this test fails and points at D41.
     */
    expect(await outbox.list()).toHaveLength(0)
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
