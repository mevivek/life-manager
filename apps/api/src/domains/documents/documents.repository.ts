import type {
  CustomAttrs,
  DocumentListQuery,
  DocumentSort,
  DocumentType,
} from '@life-manager/shared'
import { HOLDER_MINE } from '@life-manager/shared'
import {
  and,
  arrayContains,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lte,
  max,
  sql,
} from 'drizzle-orm'
import type { ActorContext } from '../../auth/actor.js'
import { type Db, db } from '../../db/client.js'
import { scoped } from '../../db/scoped.js'
import { afterCursor, type Cursor, orderByCursor } from '../../lib/cursor.js'
import { documentFiles, documents } from './documents.schema.js'

/**
 * SQL for `documents` and `document_files`. The only layer allowed to write it
 * (conventions/code.md §1), and the layer where the tenant filter lives — a service that reached
 * past this into Drizzle would bypass space isolation, which conventions/code.md §1 names as the
 * single most likely security bug in this codebase.
 *
 * Every function takes `actor` first and every query goes through `scoped(actor, table)`. There
 * are **no deliberate deviations in this file**, unlike `spaces.repository.ts` — a document
 * always has a space by the time it is touched.
 */

/** A transaction handle, or the pool. Services pass a `tx`; nothing else should. */
export type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]

/**
 * Confirmed live files per document, as a correlated subquery — so listing 50 documents is one
 * query rather than 51.
 *
 * Filtered to live, **confirmed** files: an abandoned upload (business rule 10) must not make
 * `has_file` true, or "documents with no file" — a dashboard view (spec §7) — silently stops
 * listing the documents whose only upload failed halfway.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  `db.$count`, NOT a hand-written `sql` template. This was a real bug.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The original was:
 *
 *     sql`(select count(*)::int from ${documentFiles}
 *          where ${documentFiles.documentId} = ${documents.id} ...)`
 *
 * In a **select-field** position Drizzle renders those columns *unqualified*, producing
 * `where "document_id" = "id"`. Inside the subquery `document_files` is the only table in scope and
 * it has its own `id`, so that compares `document_files.document_id` to `document_files.id` — never
 * true. Every `file_count` came back **0** while the identical expression in a `WHERE` clause
 * (where Drizzle *does* qualify) worked correctly. So `?has_file=` filtered right and the count
 * displayed wrong, which is why it survived: the UI said "no file" next to a file it had just
 * uploaded.
 *
 * `db.$count` emits `"document_files"."document_id" = "documents"."id"` — fully qualified, by
 * construction. Do not replace it with a template.
 *
 * **It also survived the tests**, which is the more useful lesson: every assertion happened to be
 * `file_count === 0` (a new document, an unconfirmed upload). Nothing asserted a *non-zero* count
 * until `documents.files.test.ts` gained one.
 */
const fileCountSql = db.$count(
  documentFiles,
  and(
    eq(documentFiles.documentId, documents.id),
    isNull(documentFiles.deletedAt),
    isNotNull(documentFiles.uploadedAt),
  ),
)

const documentColumns = { ...getTableColumns(documents), fileCount: fileCountSql }

/** The row shape every read here returns. `searchVector` is deliberately not selected. */
export type DocumentRow = Omit<typeof documents.$inferSelect, 'searchVector'> & {
  fileCount: number
}

const SORT_COLUMNS = {
  expires_on: documents.expiresOn,
  created_at: documents.createdAt,
  title: documents.title,
} as const satisfies Record<DocumentSort, unknown>

function select(executor: Executor) {
  // `searchVector` is excluded by listing columns explicitly: it is a large generated tsvector
  // that no caller reads, and shipping it on every row of every list would be pure waste.
  const { searchVector: _searchVector, ...rest } = documentColumns
  return executor.select(rest).from(documents)
}

/**
 * The filtered, sorted, paginated list. domains/documents.md §5.
 *
 * Fetches `limit + 1` rows so the caller can tell whether a next page exists without a second
 * `count(*)` — see `lib/cursor.ts`.
 */
export async function list(
  actor: ActorContext,
  query: DocumentListQuery,
  cursor: Cursor | null,
): Promise<DocumentRow[]> {
  const sortColumn = SORT_COLUMNS[query.sort]

  const filters = [
    // The tenant boundary AND the soft-delete filter, from the one shared helper so they cannot
    // drift apart (conventions/code.md §2).
    scoped(actor, documents),

    /**
     * Full-text search. `websearch_to_tsquery` rather than `to_tsquery`: it accepts whatever a
     * person types — quoted phrases, `or`, a leading `-` — and **never throws on malformed
     * input**, where `to_tsquery` raises a syntax error on something as ordinary as `a & `. The
     * user-facing consequence is that a half-typed query returns nothing instead of a 500.
     *
     * Search is still inside `scoped()` above. Full-text search is not an authorization bypass
     * (conventions/data.md §6).
     */
    query.q === undefined
      ? undefined
      : sql`${documents.searchVector} @@ websearch_to_tsquery('english', ${query.q})`,

    query.type === undefined ? undefined : inArray(documents.docType, query.type),

    // `@>` — the document's tags must contain ALL requested tags. Uses the GIN index on `tags`.
    // Repeated `?tag=` is therefore an AND, which is what a filter UI's checkboxes mean.
    query.tag === undefined ? undefined : arrayContains(documents.tags, query.tag),

    // Deliberately excludes documents with no expiry: "expiring before X" is a question about
    // things that expire, and a null `expires_on` is not "expiring before" any date.
    query.expiring_before === undefined
      ? undefined
      : lte(documents.expiresOn, query.expiring_before),

    /**
     * `?holder=mine` is `holder IS NULL` — see `documentListQuerySchema`. Anything else is an exact
     * match, and an empty-string holder is folded into "mine" too: the column should never hold `''`
     * (the create/update schemas trim and require at least one character), but a row that predates
     * this filter or arrives from a direct database edit should not become unreachable by any filter.
     */
    query.holder === undefined
      ? undefined
      : query.holder === HOLDER_MINE
        ? sql`(${documents.holder} is null or ${documents.holder} = '')`
        : eq(documents.holder, query.holder),

    query.has_file === undefined
      ? undefined
      : query.has_file
        ? sql`${fileCountSql} > 0`
        : sql`${fileCountSql} = 0`,

    cursor === null
      ? undefined
      : afterCursor({
          sortColumn,
          idColumn: documents.id,
          cursor,
          direction: query.order,
        }),
  ]

  const rows = await select(db)
    .where(and(...filters))
    .orderBy(...orderByCursor({ sortColumn, idColumn: documents.id, direction: query.order }))
    .limit(query.limit + 1)

  return rows
}

/** Reads the value a cursor must carry for a given row, so the sort field and cursor agree. */
export function cursorValueOf(row: DocumentRow, sort: DocumentSort): string | null {
  switch (sort) {
    case 'expires_on':
      return row.expiresOn
    case 'title':
      return row.title
    case 'created_at':
      return row.createdAt.toISOString()
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
): Promise<DocumentRow | undefined> {
  const rows = await select(executor)
    .where(and(scoped(actor, documents), eq(documents.id, id)))
    .limit(1)

  return rows[0]
}

export type DocumentInsert = {
  title: string
  docType: DocumentType
  issuer: string | null
  /** Full value — ADR-0026. Derived together with the mask by `identifierColumns` in the service. */
  identifier: string | null
  identifierLast4: string | null
  issuedOn: string | null
  expiresOn: string | null
  country: string | null
  notes: string | null
  tags: string[]
  customAttrs: CustomAttrs
}

export async function insert(
  actor: ActorContext,
  spaceId: string,
  values: DocumentInsert,
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(documents)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .returning({ id: documents.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert documents returned no id')
  return id
}

/**
 * Applies a patch. Returns the number of rows changed, so the service can tell "not found or not
 * yours" (0) from a real update (1) — `scoped()` makes those two indistinguishable on purpose,
 * which is what turns a cross-space write into a 404 rather than a 403.
 */
/**
 * Applies `patch` only if the row is still at `expectedVersion`, bumping the version on success.
 *
 * **The precondition is in the `WHERE`, not in a preceding `SELECT`.** Reading the version and then
 * updating would leave a window in which another writer lands between the two statements — which is
 * the very race this is supposed to close, reintroduced in application code. Postgres evaluates both
 * conditions atomically, so the number of rows returned IS the answer.
 *
 * Returns the new version, or `null` when nothing matched. `null` is deliberately ambiguous between
 * "no such document" and "version moved on": the caller cannot distinguish them from here without a
 * second read, and only the service knows that the distinction is 404 versus 409 (ADR-0024).
 */
export async function update(
  actor: ActorContext,
  id: string,
  patch: Partial<DocumentInsert>,
  expectedVersion: number,
  executor: Executor = db,
): Promise<number | null> {
  const changed = await executor
    .update(documents)
    .set({
      ...patch,
      updatedAt: new Date(),
      // `sql` rather than `expectedVersion + 1` so the increment is relative to the row the database
      // actually matched, not to a number this process is holding.
      version: sql`${documents.version} + 1`,
    })
    .where(
      and(scoped(actor, documents), eq(documents.id, id), eq(documents.version, expectedVersion)),
    )
    .returning({ version: documents.version })

  return changed[0]?.version ?? null
}

/**
 * Soft-deletes the document. Business rule 9 also requires its files and reminders to go, and
 * **that is the service's job** — this function does one table, so it can be composed inside the
 * transaction that does all three.
 */
/**
 * Soft-deletes only if the row is still at `expectedVersion` — debt D41, and the same conditional
 * shape as `update` above.
 *
 * A delete is the most destructive write there is, so it is the LAST place that should have been
 * left unconditional: without the precondition, loading a document on one device, editing it on
 * another, then deleting on the first removes the newer edit with nothing shown. The version bump is
 * kept even though the row is now deleted, so a resurrected row could never collide with a
 * precondition built against its pre-delete state.
 */
export async function softDelete(
  actor: ActorContext,
  id: string,
  expectedVersion: number,
  executor: Executor = db,
): Promise<number | null> {
  const now = new Date()
  const changed = await executor
    .update(documents)
    .set({ deletedAt: now, updatedAt: now, version: sql`${documents.version} + 1` })
    .where(
      and(scoped(actor, documents), eq(documents.id, id), eq(documents.version, expectedVersion)),
    )
    .returning({ version: documents.version })

  return changed[0]?.version ?? null
}

// ── Files ────────────────────────────────────────────────────────────────────

export type DocumentFileRow = typeof documentFiles.$inferSelect

export async function listFiles(
  actor: ActorContext,
  documentId: string,
  executor: Executor = db,
): Promise<DocumentFileRow[]> {
  return executor
    .select()
    .from(documentFiles)
    .where(and(scoped(actor, documentFiles), eq(documentFiles.documentId, documentId)))
    .orderBy(documentFiles.version)
}

export async function findFile(
  actor: ActorContext,
  documentId: string,
  fileId: string,
  executor: Executor = db,
): Promise<DocumentFileRow | undefined> {
  const rows = await executor
    .select()
    .from(documentFiles)
    .where(
      and(
        scoped(actor, documentFiles),
        eq(documentFiles.documentId, documentId),
        eq(documentFiles.id, fileId),
      ),
    )
    .limit(1)

  return rows[0]
}

/**
 * The next `version` for a document — business rule 4: assigned by the server, monotonic per
 * document, never supplied by a client.
 *
 * `max(version) + 1` over **all** versions including soft-deleted ones, deliberately: reusing a
 * deleted version number would collide with `document_files_document_id_version_key`, which is
 * not partial on `deleted_at` precisely so that version numbers are never recycled. A user who
 * deletes v3 and uploads again gets v4, and the history stays honest.
 */
export async function nextVersion(
  actor: ActorContext,
  documentId: string,
  executor: Executor = db,
): Promise<number> {
  const rows = await executor
    .select({ highest: max(documentFiles.version) })
    .from(documentFiles)
    .where(
      and(
        inArray(documentFiles.spaceId, [...actor.spaceIds]),
        eq(documentFiles.documentId, documentId),
      ),
    )

  return (rows[0]?.highest ?? 0) + 1
}

export async function insertFile(
  actor: ActorContext,
  spaceId: string,
  values: {
    documentId: string
    version: number
    storageKey: string
    mime: string
    sizeBytes: number
  },
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(documentFiles)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .returning({ id: documentFiles.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert document_files returned no id')
  return id
}

/**
 * Sets the object key, immediately after the insert that generated the file's id.
 *
 * Separate from `insertFile` because the key *contains* that id (ADR-0008's
 * `spaces/{spaceId}/documents/{documentId}/{fileId}`), and generating the uuid in application code
 * instead would make `document_files` the one table whose ids do not come from
 * `gen_random_uuid()`. Both calls run in the same transaction, so no row is ever visible with the
 * empty placeholder key.
 */
export async function setStorageKey(
  actor: ActorContext,
  fileId: string,
  storageKey: string,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(documentFiles)
    .set({ storageKey })
    .where(and(scoped(actor, documentFiles), eq(documentFiles.id, fileId)))
}

/** Marks the upload confirmed. `uploaded_at` transitioning off null is what ends rule 10's window. */
export async function confirmFile(
  actor: ActorContext,
  fileId: string,
  values: { sha256: string | null },
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(documentFiles)
    .set({ sha256: values.sha256, uploadedAt: now, updatedAt: now })
    .where(and(scoped(actor, documentFiles), eq(documentFiles.id, fileId)))
    .returning({ id: documentFiles.id })

  return changed.length
}

/**
 * Clears `is_primary` across a document's files.
 *
 * Called immediately before promoting one, **inside the same transaction** — business rule 3
 * says the previous primary is demoted in the same transaction, and
 * `document_files_one_primary_key` would reject the promotion otherwise.
 */
export async function demoteAllPrimary(
  actor: ActorContext,
  documentId: string,
  executor: Executor = db,
): Promise<void> {
  await executor
    .update(documentFiles)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        scoped(actor, documentFiles),
        eq(documentFiles.documentId, documentId),
        eq(documentFiles.isPrimary, true),
      ),
    )
}

export async function setPrimary(
  actor: ActorContext,
  fileId: string,
  executor: Executor = db,
): Promise<number> {
  const changed = await executor
    .update(documentFiles)
    .set({ isPrimary: true, updatedAt: new Date() })
    .where(and(scoped(actor, documentFiles), eq(documentFiles.id, fileId)))
    .returning({ id: documentFiles.id })

  return changed.length
}

export async function softDeleteFile(
  actor: ActorContext,
  fileId: string,
  executor: Executor = db,
): Promise<number> {
  const now = new Date()
  const changed = await executor
    .update(documentFiles)
    .set({ deletedAt: now, isPrimary: false, updatedAt: now })
    .where(and(scoped(actor, documentFiles), eq(documentFiles.id, fileId)))
    .returning({ id: documentFiles.id })

  return changed.length
}

/** Business rule 9: deleting a document soft-deletes its files. Composed into the service's tx. */
export async function softDeleteFilesFor(
  actor: ActorContext,
  documentId: string,
  executor: Executor = db,
): Promise<void> {
  const now = new Date()
  await executor
    .update(documentFiles)
    .set({ deletedAt: now, isPrimary: false, updatedAt: now })
    .where(and(scoped(actor, documentFiles), eq(documentFiles.documentId, documentId)))
}

/**
 * Distinct holders with the relation most recently filed against each — for the people picker.
 *
 * Returns pairs rather than names, so picking a known person fills both fields and the per-document
 * duplication of `relation` stays invisible to the user. `holder IS NOT NULL` excludes the owner's own
 * documents, which the picker represents as "Me" rather than as a name.
 *
 * `DISTINCT ON` needs the same leading expression in `ORDER BY`, and the secondary sort decides *which*
 * relation wins — newest, so correcting "Son (11)" to "Son (12)" on one document updates the
 * suggestion for the next rather than being outvoted by history.
 */
export async function distinctHolders(
  actor: ActorContext,
  limit = 50,
): Promise<{ holder: string; relation: string | null }[]> {
  const rows = await db
    .selectDistinctOn([documents.holder], {
      holder: documents.holder,
      relation: documents.relation,
    })
    .from(documents)
    .where(and(scoped(actor, documents), sql`${documents.holder} is not null`))
    .orderBy(documents.holder, desc(documents.createdAt))
    .limit(limit)

  return rows.flatMap((row) =>
    row.holder === null ? [] : [{ holder: row.holder, relation: row.relation }],
  )
}

/** Distinct issuers, for the autocomplete spec §9 question 1 settles on for now. */
export async function distinctIssuers(actor: ActorContext, limit = 50): Promise<string[]> {
  const rows = await db
    .selectDistinct({ issuer: documents.issuer })
    .from(documents)
    .where(and(scoped(actor, documents), sql`${documents.issuer} is not null`))
    .orderBy(documents.issuer)
    .limit(limit)

  return rows.flatMap((row) => (row.issuer === null ? [] : [row.issuer]))
}

/** Counts live documents in the actor's spaces. Used by the dashboard and by tests. */
export async function countAll(actor: ActorContext): Promise<number> {
  const rows = await db.select({ total: count() }).from(documents).where(scoped(actor, documents))
  return rows[0]?.total ?? 0
}
