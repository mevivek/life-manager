import type { DocumentCreate, DocumentUpdate } from '@life-manager/shared'
import { del, get, set } from 'idb-keyval'
import { ApiError, api, OfflineError } from './api'

/**
 * The offline write queue from [ADR-0024](../../../../docs/decisions/0024-offline-writes-outbox.md).
 *
 * A write attempted with no connectivity is stored here and replayed when the network returns. The
 * server stays the single source of truth: this is a queue of **intents**, not a second copy of the
 * data, so there is no divergent local database to reconcile.
 *
 * ── The three rules that make this safe rather than dangerous ──
 *
 * ADR-0013 rejected a naive replay queue as "actively dangerous", and ADR-0024 only reversed that
 * because of these three properties. Removing any one of them puts the old objection back:
 *
 *  1. **Every entry carries the `version` it was built against.** The server refuses a write whose
 *     version has moved on, so a replay cannot silently overwrite a change made elsewhere.
 *  2. **Every entry carries a stable `idempotencyKey`, generated once at enqueue.** A write that
 *     succeeded but whose response was lost replays the cached response instead of being applied
 *     twice — and, just as importantly, instead of surfacing a 409 against the user's own write.
 *  3. **A 409 stops that entry and surfaces it.** Nothing is merged, and nothing is retried in a
 *     loop. `status` becomes `'conflict'` and the user decides.
 *
 * ── What is deliberately NOT queued ──
 *
 * **Deletes.** `DELETE` has no version precondition yet (debt D41), so a queued delete replayed
 * after the document was edited on another device would destroy that edit with no conflict shown —
 * precisely the failure ADR-0024 exists to prevent. Until D41 is closed, a delete attempted offline
 * fails immediately and plainly, which is the honest behaviour rather than a silent data-loss path.
 */

const OUTBOX_KEY = 'life-manager-outbox'

/** A queued create. `tempId` lets the UI show the document before the server has assigned a real id. */
type CreateEntry = {
  kind: 'document.create'
  tempId: string
  input: DocumentCreate
}

/** A queued edit. `patch.version` IS the precondition — see rule 1 above. */
type UpdateEntry = {
  kind: 'document.update'
  documentId: string
  patch: DocumentUpdate
}

/**
 * A queued file upload — the offline photo capture from ADR-0024.
 *
 * The **bytes** are held here, not a presigned URL. That is what makes this work at all: a presigned
 * URL expires, so one minted at capture time would be dead by the time the network returned. The
 * presign happens at replay, which needs no change to ADR-0008's flow.
 *
 * `documentId` may be a CREATE ENTRY'S `tempId` — a photo taken of a document that was itself created
 * offline and has no server id yet. `remapTempId` below rewrites it once the create is replayed.
 */
type FileUploadEntry = {
  kind: 'file.upload'
  documentId: string
  blob: Blob
  mime: string
  sizeBytes: number
}

/** What a caller hands to `enqueue`; the queue adds the bookkeeping fields below. */
export type NewOutboxEntry = CreateEntry | UpdateEntry | FileUploadEntry

export type OutboxEntry = NewOutboxEntry & {
  id: string
  /** Generated once, at enqueue, and reused by every replay attempt. Rule 2. */
  idempotencyKey: string
  queuedAt: number
  status: 'pending' | 'conflict'
  /** Set when `status` is `'conflict'`, for the UI to explain what happened. */
  error?: string
}

/**
 * Change notification, so the UI can show a queue it does not own.
 *
 * The queue lives in IndexedDB rather than in React state — deliberately, since it has to survive a
 * reload — which means nothing re-renders when it changes. Listeners are how the pending count and
 * the conflict banner stay honest without polling.
 */
type Listener = () => void
const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function notify(): void {
  for (const listener of listeners) listener()
}

/** Entries are replayed in the order they were queued, so two edits to one document compose. */
async function read(): Promise<OutboxEntry[]> {
  return (await get<OutboxEntry[]>(OUTBOX_KEY)) ?? []
}

async function write(entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) {
    await del(OUTBOX_KEY)
  } else {
    await set(OUTBOX_KEY, entries)
  }
  notify()
}

/**
 * `crypto.randomUUID` needs a secure context, which the app always has (HTTPS, or localhost in
 * development). No fallback: a non-unique idempotency key would be worse than a hard failure,
 * because two different writes sharing a key means the second is answered with the first's response.
 */
function newId(): string {
  return crypto.randomUUID()
}

export async function enqueue(entry: NewOutboxEntry): Promise<OutboxEntry> {
  const queued: OutboxEntry = {
    ...entry,
    id: newId(),
    idempotencyKey: newId(),
    queuedAt: Date.now(),
    status: 'pending',
  }
  await write([...(await read()), queued])
  return queued
}

export async function list(): Promise<OutboxEntry[]> {
  return read()
}

export async function pendingCount(): Promise<number> {
  return (await read()).filter((entry) => entry.status === 'pending').length
}

export async function conflicts(): Promise<OutboxEntry[]> {
  return (await read()).filter((entry) => entry.status === 'conflict')
}

/** Drops one entry — used both on success and when the user discards a conflict. */
export async function remove(id: string): Promise<void> {
  await write((await read()).filter((entry) => entry.id !== id))
}

/** Deleted wholesale on sign-out, alongside the query cache. */
export async function clear(): Promise<void> {
  await del(OUTBOX_KEY)
  notify()
}

/**
 * Re-queues a conflicted entry against a newer version, for the user's "keep my version" choice.
 *
 * **This is a deliberate overwrite, and that is the point.** ADR-0024 forbids resolving a conflict
 * *automatically*; it does not forbid the user deciding. They have been shown both values, so
 * applying theirs on top is an informed choice rather than silent data loss — which is the entire
 * difference between this and the last-write-wins design the ADR rejected.
 *
 * A fresh `idempotencyKey`, because this is a NEW logical operation. Reusing the old key would make
 * the server replay the original 409 response instead of considering the retry.
 */
export async function retryWithVersion(id: string, version: number): Promise<void> {
  const entries = await read()
  await write(
    entries.map((entry) => {
      if (entry.id !== id || entry.kind !== 'document.update') return entry
      return {
        ...entry,
        patch: { ...entry.patch, version },
        idempotencyKey: newId(),
        status: 'pending' as const,
        error: undefined,
      }
    }),
  )
}

async function markConflict(id: string, message: string): Promise<void> {
  const entries = await read()
  await write(
    entries.map((entry) =>
      entry.id === id ? { ...entry, status: 'conflict' as const, error: message } : entry,
    ),
  )
}

/**
 * Rewrites queued entries that referred to a document by its temporary id.
 *
 * Without this, "photograph a document you also created offline" — the actual use case ADR-0024 was
 * reopened for — could not work: the upload would be addressed to a `tempId` the server has never
 * heard of and would 404 on presign, surfacing as a conflict the user cannot possibly resolve.
 */
async function remapTempId(tempId: string, realId: string): Promise<void> {
  const entries = await read()
  if (!entries.some((entry) => entry.kind !== 'document.create' && entry.documentId === tempId)) {
    return
  }
  await write(
    entries.map((entry) =>
      entry.kind !== 'document.create' && entry.documentId === tempId
        ? { ...entry, documentId: realId }
        : entry,
    ),
  )
}

/** Sends one entry. Split out so `replay` reads as the policy and this as the mechanism. */
async function send(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'document.create') {
    const created = await api.documents.create(entry.input, entry.idempotencyKey)
    // Anything queued against the placeholder id now points at the real document.
    await remapTempId(entry.tempId, created.id)
    return
  }

  if (entry.kind === 'file.upload') {
    /**
     * The full ADR-0008 dance, at replay time: presign → PUT the bytes → confirm.
     *
     * `File` rather than the raw `Blob`, because `api.files.upload` sends `file.type` as the
     * `content-type` header and the presigned URL signs that header — a mismatch is rejected by
     * storage. A `Blob` read back out of IndexedDB has a `type` but no name, so it is rewrapped.
     */
    const presigned = await api.files.presignUpload(entry.documentId, {
      mime: entry.mime as Parameters<typeof api.files.presignUpload>[1]['mime'],
      size_bytes: entry.sizeBytes,
      make_primary: true,
    })
    await api.files.upload(
      presigned.upload_url,
      new File([entry.blob], 'capture', { type: entry.mime }),
    )
    await api.files.confirm(entry.documentId, { file_id: presigned.file_id })
    return
  }

  await api.documents.update(entry.documentId, entry.patch, entry.idempotencyKey)
}

export type ReplayResult = {
  sent: number
  conflicted: number
  /** True when the run stopped early because the network went away again. */
  interrupted: boolean
}

/**
 * Replays every pending entry, oldest first.
 *
 * The three outcomes are handled differently on purpose, and the differences are the whole design:
 *
 *  - **Success** → the entry is dropped.
 *  - **409, or any other 4xx** → the entry is marked `'conflict'` and LEFT in the queue for the user.
 *    Retrying a 4xx is pointless: the server has made a considered judgement about this request, and
 *    a loop would just burn battery producing the same answer.
 *  - **`OfflineError`** → stop the whole run and leave everything pending. The network died
 *    mid-replay; the next reconnect picks up where this left off.
 *
 * Sequential rather than parallel, deliberately. Two queued edits to the same document must apply in
 * the order the user made them, and the second one's version precondition only becomes correct once
 * the first has landed.
 */
export async function replay(): Promise<ReplayResult> {
  const result: ReplayResult = { sent: 0, conflicted: 0, interrupted: false }

  /**
   * Iterate over IDS and re-read each entry, rather than looping over one snapshot.
   *
   * A snapshot loop holds stale objects: `send()` can rewrite *later* entries — that is exactly what
   * `remapTempId` does when a create resolves a `tempId` — and a queued photo would then be uploaded
   * against the placeholder id it had before the create ran, 404 on presign, and surface as a conflict
   * the user cannot resolve. Found by the test that queues a create and a photo together.
   */
  const ids = (await read()).map((entry) => entry.id)

  for (const id of ids) {
    const entry = (await read()).find((candidate) => candidate.id === id)
    if (entry === undefined || entry.status !== 'pending') continue

    try {
      await send(entry)
      await remove(entry.id)
      result.sent++
    } catch (error) {
      if (error instanceof OfflineError) {
        result.interrupted = true
        return result
      }

      if (error instanceof ApiError) {
        await markConflict(entry.id, error.message)
        result.conflicted++
        continue
      }

      // Something we did not anticipate — a contract drift, a Zod parse failure. Marking it a
      // conflict surfaces it rather than retrying it forever, and security-model.md §6 forbids
      // swallowing it silently.
      await markConflict(entry.id, error instanceof Error ? error.message : String(error))
      result.conflicted++
    }
  }

  return result
}
