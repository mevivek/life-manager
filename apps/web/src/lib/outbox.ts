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

export type OutboxEntry = (CreateEntry | UpdateEntry) & {
  id: string
  /** Generated once, at enqueue, and reused by every replay attempt. Rule 2. */
  idempotencyKey: string
  queuedAt: number
  status: 'pending' | 'conflict'
  /** Set when `status` is `'conflict'`, for the UI to explain what happened. */
  error?: string
}

/** Entries are replayed in the order they were queued, so two edits to one document compose. */
async function read(): Promise<OutboxEntry[]> {
  return (await get<OutboxEntry[]>(OUTBOX_KEY)) ?? []
}

async function write(entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) {
    await del(OUTBOX_KEY)
    return
  }
  await set(OUTBOX_KEY, entries)
}

/**
 * `crypto.randomUUID` needs a secure context, which the app always has (HTTPS, or localhost in
 * development). No fallback: a non-unique idempotency key would be worse than a hard failure,
 * because two different writes sharing a key means the second is answered with the first's response.
 */
function newId(): string {
  return crypto.randomUUID()
}

export async function enqueue(entry: CreateEntry | UpdateEntry): Promise<OutboxEntry> {
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
}

async function markConflict(id: string, message: string): Promise<void> {
  const entries = await read()
  await write(
    entries.map((entry) =>
      entry.id === id ? { ...entry, status: 'conflict' as const, error: message } : entry,
    ),
  )
}

/** Sends one entry. Split out so `replay` reads as the policy and this as the mechanism. */
async function send(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'document.create') {
    await api.documents.create(entry.input, entry.idempotencyKey)
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

  for (const entry of await read()) {
    if (entry.status !== 'pending') continue

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
