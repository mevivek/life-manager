import type {
  DocumentCreate,
  DocumentUpdate,
  ThingCreate,
  ThingServiceCreate,
  ThingUpdate,
} from '@life-manager/shared'
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
 * **Deletes.** `DELETE` now carries a `?version=` precondition of its own (D41, closed), so queueing
 * one would be *safe*. It is still not queued, because safe is not the same as good: a delete that
 * sits in a queue for hours and then comes back as a conflict is a confusing thing to explain, and
 * unlike an edit there is nothing to re-apply afterwards. A delete attempted offline fails
 * immediately and plainly. That is now a product choice, and reversing it is a small change.
 *
 * **Rearranging a thing's photos** — promoting a hero, removing one. Same reasoning as a delete, plus
 * one of its own: both are decisions *about* a set the user is looking at, and replaying them hours
 * later against a set that has since changed is how you promote the wrong photo.
 *
 * ── Two domains now, and the entry shapes are deliberately NOT unified ──
 *
 * A document entry keys its parent as `documentId`, a thing entry as `thingId`. Merging them into one
 * `subjectId` would read better and is the wrong trade: **this queue is persisted in IndexedDB**, so a
 * rename orphans every entry queued by an already-installed bundle — the write is silently addressed
 * to `undefined` and lost. That is D87's failure mode with the halves swapped again, and the cost of
 * avoiding it is one extra branch in `remapTempId`. Add fields; do not rename them.
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

/** A queued thing. The sibling of `CreateEntry`, and `tempId` does the same job. */
type ThingCreateEntry = {
  kind: 'thing.create'
  tempId: string
  input: ThingCreate
}

/** A queued edit to a thing. `patch.version` IS the precondition — rule 1, exactly as for a document. */
type ThingUpdateEntry = {
  kind: 'thing.update'
  thingId: string
  patch: ThingUpdate
}

/**
 * A queued service record — "serviced today" written down at the garage, where the signal is.
 *
 * This is the one queued write with no document equivalent, and it earns its place: a service is
 * logged at the moment it happens, in exactly the sort of place that has no connection, and the date
 * it carries is `serviced_on` rather than "now" — so a replay hours later still records the right day.
 *
 * `thingId` may be a `ThingCreateEntry`'s `tempId`, same as a photo's.
 */
type ThingServiceEntry = {
  kind: 'thing.service'
  thingId: string
  input: ThingServiceCreate
}

/**
 * A queued thing photo. `FileUploadEntry`'s sibling, and the bytes are held here for the same reason:
 * a presigned URL minted at capture time would have expired by the time the network returned.
 *
 * `makeHero` is carried rather than defaulted, because the server's default is `true` and confirming a
 * `make_hero` row demotes its siblings. A photo added from the strip an hour ago must not steal the
 * main slot when it finally uploads — see `useUploadThingPhoto`.
 */
type ThingPhotoEntry = {
  kind: 'thing.photo'
  thingId: string
  blob: Blob
  mime: string
  sizeBytes: number
  makeHero: boolean
}

/** What a caller hands to `enqueue`; the queue adds the bookkeeping fields below. */
export type NewOutboxEntry =
  | CreateEntry
  | UpdateEntry
  | FileUploadEntry
  | ThingCreateEntry
  | ThingUpdateEntry
  | ThingServiceEntry
  | ThingPhotoEntry

export type OutboxEntry = NewOutboxEntry & {
  id: string
  /** Generated once, at enqueue, and reused by every replay attempt. Rule 2. */
  idempotencyKey: string
  queuedAt: number
  status: 'pending' | 'conflict'
  /** Set when `status` is `'conflict'`, for the UI to explain what happened. */
  error?: string
  /**
   * Replay attempts that failed with a network error **while the browser reported being online**.
   *
   * Offline attempts are not counted — waiting is the correct behaviour when there is genuinely no
   * network. This counts the other case, which is the dangerous one. See `MAX_ONLINE_ATTEMPTS`.
   */
  attempts?: number
}

/**
 * How many times a write may fail at the network layer, while online, before it stops being called
 * "waiting to send" and starts asking for attention.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A queue that can never drain, and never says so, is worse than a failed request.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `fetch` rejects — and therefore produces an `OfflineError` — for several reasons that are NOT
 * "you are offline", and the browser deliberately refuses to tell them apart:
 *
 *   · a CORS policy that does not allow the request (the R2 bucket's, or the API's)
 *   · DNS or TLS failure
 *   · a request blocked by an extension or a captive portal
 *
 * Every one of those looks identical to a dropped connection from JavaScript. Without this counter
 * the write is re-queued forever under a banner promising it will be sent "when you are back
 * online", which is a lie the user cannot act on — the phone shows full signal and nothing happens,
 * indefinitely. Three attempts is enough to rule out a genuinely flaky moment.
 */
const MAX_ONLINE_ATTEMPTS = 3

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

/**
 * Runs a write, and queues it in the outbox if there is no connectivity (ADR-0024).
 *
 * The attempt comes FIRST, and the queue is the fallback — not the other way round. Checking
 * `navigator.onLine` up front and queueing on `false` would be wrong in both directions: it reports
 * `true` behind a captive portal (so the write would be attempted and lost anyway) and it can report
 * `false` on a working connection. An `OfflineError` is proof the request did not reach the server;
 * a status code is proof that it did.
 *
 * Anything else — a 409, a 422 — is rethrown untouched. A request the server has *judged* must not be
 * queued for a retry that would get the same answer.
 *
 * Lives here rather than in `features/documents`, where it was written, because Things needs it too
 * and a feature folder importing another feature's private helper is how the two copies start.
 */
export async function writeOrQueue<T>(
  attempt: () => Promise<T>,
  queued: () => NewOutboxEntry,
): Promise<T | { queued: true }> {
  try {
    return await attempt()
  } catch (error) {
    if (error instanceof OfflineError) {
      await enqueue(queued())
      return { queued: true }
    }
    throw error
  }
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
      if (entry.id !== id) return entry
      // Branched per kind rather than spread over the union: `patch` has a different type in each,
      // and a single spread would widen it to `DocumentUpdate | ThingUpdate` on both branches.
      if (entry.kind === 'document.update') {
        return {
          ...entry,
          patch: { ...entry.patch, version },
          idempotencyKey: newId(),
          status: 'pending' as const,
          error: undefined,
        }
      }
      if (entry.kind === 'thing.update') {
        return {
          ...entry,
          patch: { ...entry.patch, version },
          idempotencyKey: newId(),
          status: 'pending' as const,
          error: undefined,
        }
      }
      return entry
    }),
  )
}

/** Records a failed online attempt without changing the entry's status. */
async function bumpAttempts(id: string, attempts: number): Promise<void> {
  const entries = await read()
  await write(entries.map((entry) => (entry.id === id ? { ...entry, attempts } : entry)))
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
async function remapTempId(
  subject: 'document' | 'thing',
  tempId: string,
  realId: string,
): Promise<void> {
  const entries = await read()

  const matches = (entry: OutboxEntry): boolean =>
    subject === 'document'
      ? hangsOffADocument(entry) && entry.documentId === tempId
      : hangsOffAThing(entry) && entry.thingId === tempId

  if (!entries.some(matches)) return

  await write(
    entries.map((entry) => {
      if (!matches(entry)) return entry
      if (hangsOffADocument(entry)) return { ...entry, documentId: realId }
      if (hangsOffAThing(entry)) return { ...entry, thingId: realId }
      return entry
    }),
  )
}

/**
 * The entries that name a parent record, split by which domain that parent is in.
 *
 * Written as predicates rather than as `kind !== '…create'` — which is what this was when there was
 * one domain — because "not a create" stopped implying "has a `documentId`" the moment a second
 * domain's entries joined the union.
 */
function hangsOffADocument(entry: OutboxEntry): entry is OutboxEntry & { documentId: string } {
  return entry.kind === 'document.update' || entry.kind === 'file.upload'
}

function hangsOffAThing(entry: OutboxEntry): entry is OutboxEntry & { thingId: string } {
  return (
    entry.kind === 'thing.update' || entry.kind === 'thing.service' || entry.kind === 'thing.photo'
  )
}

/**
 * Sends one entry. Split out so `replay` reads as the policy and this as the mechanism.
 *
 * An exhaustive `switch` with a `never` default rather than a chain of `if`s ending in a bare
 * `documents.update` — which is what this was for three kinds. With seven, the implicit final branch
 * is a trap: a new kind would fall into it and be sent as a document edit against a `documentId` it
 * does not have. Now it is a compile error (conventions/code.md §5).
 */
async function send(entry: OutboxEntry): Promise<void> {
  switch (entry.kind) {
    case 'document.create': {
      const created = await api.documents.create(entry.input, entry.idempotencyKey)
      // Anything queued against the placeholder id now points at the real document.
      await remapTempId('document', entry.tempId, created.id)
      return
    }

    case 'document.update':
      await api.documents.update(entry.documentId, entry.patch, entry.idempotencyKey)
      return

    case 'file.upload': {
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

    case 'thing.create': {
      const created = await api.things.create(entry.input, entry.idempotencyKey)
      // A photo or a service logged against the placeholder now points at the real thing.
      await remapTempId('thing', entry.tempId, created.id)
      return
    }

    case 'thing.update':
      await api.things.update(entry.thingId, entry.patch, entry.idempotencyKey)
      return

    case 'thing.service':
      await api.things.logService(entry.thingId, entry.input, entry.idempotencyKey)
      return

    case 'thing.photo': {
      // things.md §5's three steps, and the same rewrap for the same signed-header reason as above.
      const presigned = await api.things.photos.presignUpload(entry.thingId, {
        mime: entry.mime as Parameters<typeof api.things.photos.presignUpload>[1]['mime'],
        size_bytes: entry.sizeBytes,
        make_hero: entry.makeHero,
      })
      await api.files.upload(
        presigned.upload_url,
        new File([entry.blob], 'capture', { type: entry.mime }),
      )
      await api.things.photos.confirm(entry.thingId, presigned.photo_id)
      return
    }

    default: {
      const exhaustive: never = entry
      throw new Error(`unhandled outbox entry: ${JSON.stringify(exhaustive)}`)
    }
  }
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
        /**
         * Genuinely offline: stop, change nothing, try again on reconnect. Waiting is right, and
         * counting these against the entry would eventually condemn a write for the crime of being
         * made on a train.
         */
        if (!navigator.onLine) {
          result.interrupted = true
          return result
        }

        /**
         * Online, and the request still never reached the server. That is not a connectivity
         * problem — see `MAX_ONLINE_ATTEMPTS`. Count it, and once it has failed enough times, stop
         * pretending it is queued and ask the user to look.
         */
        const attempts = (entry.attempts ?? 0) + 1
        if (attempts >= MAX_ONLINE_ATTEMPTS) {
          await markConflict(
            entry.id,
            'This could not be sent even though you appear to be online. The request never reached the server, which usually means a configuration problem rather than a connection one.',
          )
          result.conflicted++
          continue
        }

        await bumpAttempts(entry.id, attempts)
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
