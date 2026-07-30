import type { Ownership, ThingKind, ThingListQuery, ThingSort } from '@life-manager/shared'
import { HOLDER_MINE } from '@life-manager/shared'
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from 'drizzle-orm'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { scoped } from '../../db/scoped.js'
import { afterCursor, type Cursor, orderByCursor } from '../../lib/cursor.js'
import type { Executor } from '../documents/documents.repository.js'
import { documents } from '../documents/documents.schema.js'
import { thingPhotos, thingServices, things } from './things.schema.js'

/**
 * Re-exported so `things.service.ts` can type a `tx` handle without importing from the *documents*
 * repository to talk about a things transaction. The type itself is declared once, in
 * `documents.repository.ts` — it describes Drizzle's pool-or-transaction union and has nothing
 * domain-specific in it. `reminders.repository.ts` imports it from there for the same reason.
 */
export type { Executor }

/**
 * SQL for `things`, `thing_services` and `thing_photos`. The only layer allowed to write it
 * (conventions/code.md §1).
 *
 * Every function takes `actor` first and every query goes through `scoped(actor, table)` — the
 * one shared tenant filter, which this domain uses **unchanged**. That was the thing ADR-0029 said
 * would be measured by adding a second domain: `scoped()` needed no edit, because `spaceScoped()`
 * gives every table here the two columns its structural type requires.
 *
 * There are **no deliberate deviations in this file** — no `…ForMaintenance` function, because
 * nothing about Things runs without an actor yet (things.md §6: the reminder capability exists, the
 * automatic creation does not).
 */

/**
 * Live documents filed against each thing — the "3 documents" line on a row, without an N+1.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  `documents.space_id = things.space_id` IS LOAD-BEARING. It was missing, and a test caught it.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * This first read `and(eq(documents.thingId, things.id), isNull(documents.deletedAt))` with a comment
 * confidently arguing that a space predicate was redundant — *"a document and the thing it is filed
 * against are in the same space by construction"*. **That is false**, and the reasoning is worth
 * keeping because it is the kind that sounds right:
 *
 *  - `documents.thing_id` has a foreign key to `things(id)`, which checks that a thing **exists** and
 *    cannot check whose space it is in.
 *  - Documents deliberately does **not** validate the link against the actor's spaces — a `thing_id`
 *    is a *label on a row*, exactly like `holder`, and `documents.test.ts` asserts that a caller may
 *    file against another space's thing id and gain nothing by it.
 *
 * So a caller in space B who knows (or guesses) a thing id in space A could file a document against
 * it and **inflate space A's `document_count`** — a cross-space read of a number, which invariant 4's
 * "never confirm a record exists" rule cares about directly. The nested `documents` summary was
 * always correct (it goes through `scoped()`), which is exactly what would have made this survive:
 * the list said "3 documents" and the section below it showed two.
 *
 * `db.$count`, not a hand-written `sql` template — debt D33. In a **select-field** position Drizzle
 * renders columns *unqualified*, so `sql\`… where ${documents.thingId} = ${things.id}\`` becomes
 * `where "thing_id" = "id"` and resolves `"id"` against `documents`' own id: never true, so every
 * count comes back 0 while the identical expression in a `WHERE` clause works. `documents.file_count`
 * was wrong for the whole of M1 for exactly that reason. `db.$count` qualifies by construction — do
 * not replace it with a template, and note that it is also what makes the correlated
 * `space_id = space_id` comparison above render correctly.
 */
const documentCountSql = db.$count(
  documents,
  and(
    eq(documents.thingId, things.id),
    eq(documents.spaceId, things.spaceId),
    isNull(documents.deletedAt),
  ),
)

/**
 * Live, **confirmed** photos per thing.
 *
 * Confirmed only, for the same reason `file_count` is: an abandoned upload (a presign the client
 * never came back from) must not make a thing look as though it has a photo, because the list
 * thumbnail would then be a slot with nothing to put in it.
 *
 * **No space predicate here, and unlike the count above that really is safe.** A photo's `space_id`
 * is not chosen by any caller: `things.photos.service.ts` reads it from the thing the actor just
 * passed the tenant filter for (`requireThingSpace`), so a cross-space photo is unconstructible
 * rather than merely unlikely. The asymmetry with `documentCountSql` is the asymmetry between a
 * column a client may set and one it may not.
 */
const photoCountSql = db.$count(
  thingPhotos,
  and(
    eq(thingPhotos.thingId, things.id),
    isNull(thingPhotos.deletedAt),
    isNotNull(thingPhotos.uploadedAt),
  ),
)

const thingColumns = {
  ...getTableColumns(things),
  documentCount: documentCountSql,
  photoCount: photoCountSql,
}

/** The row shape every read here returns. `searchVector` is deliberately not selected. */
export type ThingRow = Omit<typeof things.$inferSelect, 'searchVector'> & {
  documentCount: number
  photoCount: number
}

/**
 * The sort whitelist. `satisfies Record<ThingSort, unknown>` is what makes adding a sort option to
 * the contract a **compile error** here rather than a runtime "unknown sort" (conventions/api.md §7
 * — `sort` is a whitelist, never passed through to SQL).
 */
const SORT_COLUMNS = {
  name: things.name,
  purchased_on: things.purchasedOn,
  warranty_ends_on: things.warrantyEndsOn,
  service_due_on: things.serviceDueOn,
} as const satisfies Record<ThingSort, unknown>

function select(executor: Executor) {
  // `searchVector` is excluded by listing columns explicitly: a large generated tsvector that no
  // caller reads, and shipping it on every row of every list would be pure waste.
  const { searchVector: _searchVector, ...rest } = thingColumns
  return executor.select(rest).from(things)
}

/**
 * The filtered, sorted, paginated list. things.md §5.
 *
 * Fetches `limit + 1` rows so the caller can tell whether a next page exists without a second
 * `count(*)` — see `lib/cursor.ts`.
 */
export async function list(
  actor: ActorContext,
  query: ThingListQuery,
  cursor: Cursor | null,
): Promise<ThingRow[]> {
  const sortColumn = SORT_COLUMNS[query.sort]

  const filters = [
    // The tenant boundary AND the soft-delete filter, from the one shared helper so they cannot
    // drift apart (conventions/code.md §2).
    scoped(actor, things),

    /**
     * Full-text search over `search_vector`. `websearch_to_tsquery` rather than `to_tsquery`,
     * exactly as Documents does it: it accepts whatever a person types and **never throws on
     * malformed input**, where `to_tsquery` raises a syntax error on something as ordinary as
     * `a & `. The user-facing consequence of getting this wrong is a 500 on a half-typed query.
     */
    query.q === undefined
      ? undefined
      : sql`${things.searchVector} @@ websearch_to_tsquery('english', ${query.q})`,

    // Repeatable, so several kinds are an OR — which is what a row of filter chips means.
    query.kind === undefined ? undefined : inArray(things.kind, query.kind),

    /**
     * `?holder=mine` is `holder IS NULL` — the literal sentinel `HOLDER_MINE`, not `''`. Identical
     * to the documents filter, including folding an empty-string holder into "mine": the column
     * should never hold `''` (the schemas trim and require a character), but a row from a direct
     * database edit must not become unreachable by every filter.
     */
    query.holder === undefined
      ? undefined
      : query.holder === HOLDER_MINE
        ? sql`(${things.holder} is null or ${things.holder} = '')`
        : eq(things.holder, query.holder),

    /**
     * Repeatable, unlike `holder` — "show me what is here or lent" is a real question and
     * `?ownership=here&ownership=lent` is how it is asked (things.md §5).
     *
     * Note what this filter is **not**: `gone` is not excluded by default. Business rule 4 says a
     * gone thing is *dimmed in the list, not hidden* — hiding it would make the archive lie about
     * what it holds. The exclusions live where they belong: the sum insured and the Now horizon.
     */
    query.ownership === undefined ? undefined : inArray(things.ownership, query.ownership),

    cursor === null
      ? undefined
      : afterCursor({
          sortColumn,
          idColumn: things.id,
          cursor,
          direction: query.order,
        }),
  ]

  return select(db)
    .where(and(...filters))
    .orderBy(...orderByCursor({ sortColumn, idColumn: things.id, direction: query.order }))
    .limit(query.limit + 1)
}

/** Reads the value a cursor must carry for a given row, so the sort field and cursor agree. */
export function cursorValueOf(row: ThingRow, sort: ThingSort): string | null {
  switch (sort) {
    case 'name':
      return row.name
    case 'purchased_on':
      return row.purchasedOn
    case 'warranty_ends_on':
      return row.warrantyEndsOn
    case 'service_due_on':
      return row.serviceDueOn
    default: {
      // Exhaustive switch with a `never` default (conventions/code.md §5): adding a sort option
      // becomes a compile error here rather than a silent wrong cursor.
      const exhaustive: never = sort
      throw new Error(`unhandled sort: ${String(exhaustive)}`)
    }
  }
}

export async function findById(
  actor: ActorContext,
  id: string,
  executor: Executor = db,
): Promise<ThingRow | undefined> {
  const rows = await select(executor)
    .where(and(scoped(actor, things), eq(things.id, id)))
    .limit(1)

  return rows[0]
}

export type ThingInsert = {
  name: string
  kind: ThingKind
  brand: string | null
  model: string | null
  /** Full value. Derived together with the mask by `serialColumns` in the service — rule 7. */
  serial: string | null
  serialLast4: string | null
  purchasedOn: string | null
  /** A decimal **string**, never a number — conventions/data.md §4. */
  price: string | null
  currency: string | null
  warrantyEndsOn: string | null
  serviceEveryMonths: number | null
  serviceDueOn: string | null
  keptAt: string | null
  holder: string | null
  relation: string | null
  ownership: Ownership
  ownershipWho: string | null
  ownershipSince: string | null
  notes: string | null
}

export async function insert(
  actor: ActorContext,
  spaceId: string,
  values: ThingInsert,
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(things)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .returning({ id: things.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert things returned no id')
  return id
}

/**
 * Applies `patch` only if the row is still at `expectedVersion`, bumping the version on success.
 *
 * **The precondition is in the `WHERE`, not in a preceding `SELECT`.** Reading the version and then
 * updating leaves a window for another writer to land between the two statements — the very race
 * this exists to close, reintroduced in application code. Postgres evaluates both conditions
 * atomically, so the number of rows returned IS the answer.
 *
 * Returns the new version, or `null` when nothing matched. `null` is deliberately ambiguous between
 * "no such thing" and "version moved on": only the service knows that distinction is 404 versus 409
 * (ADR-0024), and it has the pre-read row to tell them apart with.
 */
export async function update(
  actor: ActorContext,
  id: string,
  patch: Partial<ThingInsert>,
  expectedVersion: number,
  executor: Executor = db,
): Promise<number | null> {
  const changed = await executor
    .update(things)
    .set({
      ...patch,
      updatedAt: new Date(),
      // `sql` rather than `expectedVersion + 1`, so the increment is relative to the row the
      // database actually matched rather than to a number this process is holding.
      version: sql`${things.version} + 1`,
    })
    .where(and(scoped(actor, things), eq(things.id, id), eq(things.version, expectedVersion)))
    .returning({ version: things.version })

  return changed[0]?.version ?? null
}

/**
 * Writes a **server-derived** column with no version precondition and no version bump.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This is the one write here that skips ADR-0024, and the reason is narrow.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `service_due_on` after a logged service is not a value the caller sent — it is
 * `serviced_on + service_every_months`, computed by the service (business rule 3). ADR-0024's
 * precondition exists to stop a write built from a **stale read of the field being changed** from
 * clobbering a newer one, and there is no such read here: the caller posted a service date, not a
 * due date.
 *
 * Two consequences, both intended. Refusing this write because the thing had been renamed on another
 * device would block a service log for a reason the user cannot act on. And **not** bumping the
 * version keeps a form the user has open on the thing still editable, instead of 409ing them because
 * a derived date moved underneath.
 *
 * `Pick<>` rather than `Partial<ThingInsert>` so this cannot quietly grow into a second, unchecked
 * path for editing user-supplied columns. Widening it is a decision, not an edit.
 */
export async function updateDerived(
  actor: ActorContext,
  id: string,
  values: Pick<Partial<ThingInsert>, 'serviceDueOn'>,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(things)
    .set({ ...values, updatedAt: new Date() })
    .where(and(scoped(actor, things), eq(things.id, id)))
}

/**
 * Soft-deletes the thing, only if it is still at `expectedVersion` — the same conditional shape as
 * `update`, and for the reason debt D41 records: a delete built against stale data would otherwise
 * destroy an edit made somewhere else, permanently, since this app has no restore endpoint.
 *
 * **This deliberately does not touch `documents.thing_id`** — one function, one table, so the
 * service can compose it inside the transaction that also unlinks the documents and soft-deletes the
 * log and the photos.
 *
 * The unlinking has to be done in application code rather than left to the foreign key, because
 * `on delete set null` fires only on a **hard** delete and every delete a user can perform here is
 * a soft one (conventions/data.md §3). The constraint is what makes rule 5 true if a row is ever
 * genuinely purged; `things.service.ts` is what makes it true today.
 */
export async function softDelete(
  actor: ActorContext,
  id: string,
  expectedVersion: number,
  executor: Executor = db,
): Promise<number | null> {
  const now = new Date()
  const changed = await executor
    .update(things)
    .set({ deletedAt: now, updatedAt: now, version: sql`${things.version} + 1` })
    .where(and(scoped(actor, things), eq(things.id, id), eq(things.version, expectedVersion)))
    .returning({ version: things.version })

  return changed[0]?.version ?? null
}

/**
 * Distinct holders with the relation most recently filed against each — for the people picker.
 *
 * The same query as `documents.distinctHolders`, over this table. Not shared with it: a holder on a
 * thing and a holder on a document are the same *concept* and two different columns, and one
 * function reading both would have to decide how to merge two independent "most recent relation"
 * answers. Two pickers, two lists, one meaning.
 *
 * `DISTINCT ON` needs its leading expression first in `ORDER BY`, and the secondary sort decides
 * *which* relation wins — newest, so a correction propagates to the next suggestion rather than
 * being outvoted by history.
 */
export async function distinctHolders(
  actor: ActorContext,
  limit = 50,
): Promise<{ holder: string; relation: string | null }[]> {
  const rows = await db
    .selectDistinctOn([things.holder], { holder: things.holder, relation: things.relation })
    .from(things)
    .where(and(scoped(actor, things), sql`${things.holder} is not null`))
    .orderBy(things.holder, desc(things.createdAt))
    .limit(limit)

  return rows.flatMap((row) =>
    row.holder === null ? [] : [{ holder: row.holder, relation: row.relation }],
  )
}

/** Counts live things in the actor's spaces. Used by tests. */
export async function countAll(actor: ActorContext): Promise<number> {
  const rows = await db.select({ total: count() }).from(things).where(scoped(actor, things))
  return rows[0]?.total ?? 0
}

// ── Services ─────────────────────────────────────────────────────────────────

export type ThingServiceRow = typeof thingServices.$inferSelect

/**
 * One thing's service log, **newest first** — things.md's detail response contract says so, and it
 * is also the order the derivation reads: `services[0]` is the row `service_due_on` came from.
 *
 * `id desc` after `serviced_on desc` so two services logged on the same day have a stable order.
 * Without it the "newest" row is whichever Postgres happens to return, and the recomputed due date
 * would flip between two equally-valid answers on successive reads.
 */
export async function listServices(
  actor: ActorContext,
  thingId: string,
  executor: Executor = db,
): Promise<ThingServiceRow[]> {
  return executor
    .select()
    .from(thingServices)
    .where(and(scoped(actor, thingServices), eq(thingServices.thingId, thingId)))
    .orderBy(desc(thingServices.servicedOn), desc(thingServices.id))
}

export async function findService(
  actor: ActorContext,
  thingId: string,
  serviceId: string,
  executor: Executor = db,
): Promise<ThingServiceRow | undefined> {
  const rows = await executor
    .select()
    .from(thingServices)
    .where(
      and(
        scoped(actor, thingServices),
        eq(thingServices.thingId, thingId),
        eq(thingServices.id, serviceId),
      ),
    )
    .limit(1)

  return rows[0]
}

export async function insertService(
  actor: ActorContext,
  spaceId: string,
  values: {
    thingId: string
    servicedOn: string
    cost: string | null
    currency: string | null
    provider: string | null
    notes: string | null
  },
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(thingServices)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .returning({ id: thingServices.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert thing_services returned no id')
  return id
}

export async function softDeleteService(
  actor: ActorContext,
  serviceId: string,
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(thingServices)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(scoped(actor, thingServices), eq(thingServices.id, serviceId)))
    .returning({ id: thingServices.id })

  return changed.length
}

/** Business rule 5's sibling: deleting a thing soft-deletes its log. Composed into the service's tx. */
export async function softDeleteServicesFor(
  actor: ActorContext,
  thingId: string,
  executor: Executor = db,
): Promise<void> {
  const now = new Date()
  await executor
    .update(thingServices)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(scoped(actor, thingServices), eq(thingServices.thingId, thingId)))
}

// ── Photos ───────────────────────────────────────────────────────────────────

export type ThingPhotoRow = typeof thingPhotos.$inferSelect

/**
 * A thing's photos, oldest first.
 *
 * Oldest first rather than newest, unlike the service log: the strip on the detail screen reads as
 * the order they were added, and "the newest remaining photo" — which the hero successor needs — is
 * then the last element rather than requiring a second ordering.
 */
export async function listPhotos(
  actor: ActorContext,
  thingId: string,
  executor: Executor = db,
): Promise<ThingPhotoRow[]> {
  return executor
    .select()
    .from(thingPhotos)
    .where(and(scoped(actor, thingPhotos), eq(thingPhotos.thingId, thingId)))
    .orderBy(thingPhotos.createdAt, thingPhotos.id)
}

export async function findPhoto(
  actor: ActorContext,
  thingId: string,
  photoId: string,
  executor: Executor = db,
): Promise<ThingPhotoRow | undefined> {
  const rows = await executor
    .select()
    .from(thingPhotos)
    .where(
      and(
        scoped(actor, thingPhotos),
        eq(thingPhotos.thingId, thingId),
        eq(thingPhotos.id, photoId),
      ),
    )
    .limit(1)

  return rows[0]
}

export async function insertPhoto(
  actor: ActorContext,
  spaceId: string,
  values: {
    thingId: string
    storageKey: string
    mime: string
    sizeBytes: number
    isHero: boolean
  },
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(thingPhotos)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .returning({ id: thingPhotos.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert thing_photos returned no id')
  return id
}

/**
 * Sets the object key, immediately after the insert that generated the photo's id.
 *
 * Separate from `insertPhoto` because the key *contains* that id
 * (`spaces/{spaceId}/things/{thingId}/{photoId}`), and generating the uuid in application code
 * instead would make `thing_photos` a table whose ids do not come from `gen_random_uuid()`. Both
 * calls run in one transaction, so no row is ever visible with the empty placeholder key.
 */
export async function setPhotoStorageKey(
  actor: ActorContext,
  photoId: string,
  storageKey: string,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(thingPhotos)
    .set({ storageKey })
    .where(and(scoped(actor, thingPhotos), eq(thingPhotos.id, photoId)))
}

/** Marks the upload confirmed. `uploaded_at` going non-null is what makes a photo displayable. */
export async function confirmPhoto(
  actor: ActorContext,
  photoId: string,
  values: { sha256: string | null },
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(thingPhotos)
    .set({ sha256: values.sha256, uploadedAt: now, updatedAt: now })
    .where(and(scoped(actor, thingPhotos), eq(thingPhotos.id, photoId)))
    .returning({ id: thingPhotos.id })

  return changed.length
}

/**
 * Clears `is_hero` on every one of a thing's photos **except** `keepPhotoId`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Call this BEFORE the statement that promotes or confirms, never after. Measured.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A non-deferrable unique index is checked at each statement, not at commit, so
 * `thing_photos_one_hero_key` sees the intermediate state. The first version of
 * `things.photos.service.ts` confirmed the incoming photo and *then* demoted the old hero — which
 * meant that for the length of one statement there were two confirmed heroes, and Postgres rejected
 * the confirm outright. Four tests caught it; the symptom was a 500 on the second photo of any thing.
 *
 * ── Why `keepPhotoId` rather than "demote all confirmed" ──
 *
 * An unconfirmed row can carry `is_hero` as the *intention* declared at presign time (see the index's
 * comment on the schema). Demoting only the confirmed rows would leave those intentions set, so a
 * thing could report two `is_hero: true` photos on one response — true of the column, misleading on
 * the wire. Clearing everything but the winner keeps **exactly one flagged row per thing** once any
 * confirm or promotion has run, which is a far easier invariant to hold in your head.
 *
 * The visible consequence: two uploads that both asked to be hero resolve to whichever confirms
 * first, because the second one's intention was cleared. Deterministic, and the alternative (last
 * confirm wins) is not worth a second flag-tracking column.
 */
export async function demoteHeroesExcept(
  actor: ActorContext,
  thingId: string,
  keepPhotoId: string,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(thingPhotos)
    .set({ isHero: false, updatedAt: new Date() })
    .where(
      and(
        scoped(actor, thingPhotos),
        eq(thingPhotos.thingId, thingId),
        eq(thingPhotos.isHero, true),
        ne(thingPhotos.id, keepPhotoId),
      ),
    )
}

export async function setHero(
  actor: ActorContext,
  photoId: string,
  executor: Executor = db,
): Promise<number> {
  const changed = await executor
    .update(thingPhotos)
    .set({ isHero: true, updatedAt: new Date() })
    .where(and(scoped(actor, thingPhotos), eq(thingPhotos.id, photoId)))
    .returning({ id: thingPhotos.id })

  return changed.length
}

export async function softDeletePhoto(
  actor: ActorContext,
  photoId: string,
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(thingPhotos)
    .set({ deletedAt: now, isHero: false, updatedAt: now })
    .where(and(scoped(actor, thingPhotos), eq(thingPhotos.id, photoId)))
    .returning({ id: thingPhotos.id })

  return changed.length
}

/** Deleting a thing soft-deletes its photos. The stored objects are left alone (ADR-0008). */
export async function softDeletePhotosFor(
  actor: ActorContext,
  thingId: string,
  executor: Executor = db,
): Promise<void> {
  const now = new Date()
  await executor
    .update(thingPhotos)
    .set({ deletedAt: now, isHero: false, updatedAt: now })
    .where(and(scoped(actor, thingPhotos), eq(thingPhotos.thingId, thingId)))
}
