import { and, asc, count, eq, getTableColumns, isNull, sql } from 'drizzle-orm'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { scoped } from '../../db/scoped.js'
import type { Executor } from '../documents/documents.repository.js'
import { documents } from '../documents/documents.schema.js'
import { things } from '../things/things.schema.js'
import { people } from './people.schema.js'

/**
 * SQL for `people`. The only layer allowed to write it (conventions/code.md §1).
 *
 * Every function takes `actor` first and every query goes through `scoped(actor, table)` — the one
 * shared tenant filter, unchanged (invariants 2 and 3). No business logic, no transactions of its
 * own: the rename's transaction is owned by `people.service.ts`, which is why every write here takes
 * an optional `executor`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Two functions here write ANOTHER domain's table. That is ADR-0034's stated cost.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `renameHolderOnDocuments` and `renameHolderOnThings` update `documents.holder` and `things.holder`.
 * ADR-0034 § Consequences names the coupling and the mitigation in one sentence: *"Rename is O(rows)
 * and touches two domains' tables from a third domain's service. That is a real coupling, and it is
 * confined to one transaction in one function so it is at least findable."*
 *
 * They live **here** rather than in the sibling repositories for that reason — one folder holds the
 * whole of the rename, so a reader asking "what does renaming someone touch?" has one file to read.
 * The precedent is `things.repository.ts`, which already reads `documents` for its `document_count`;
 * a repository touching a neighbour's table is established, and the layering rule that matters is
 * that the SQL is in a repository at all.
 */

/** Re-exported so the service can type a `tx` handle without importing from Documents. */
export type { Executor }

/**
 * Live documents filed under this person's name — the *"4 records filed under them"* the remove
 * sheet states, without an N+1.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  `documents.space_id = people.space_id` IS LOAD-BEARING, and so is `db.$count`.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Both traps are the ones add-a-domain.md §4 records from M4 step 1:
 *
 *  - **The outer query being `scoped()` does not scope the subquery.** `holder` is free text a
 *    caller in any space may type, so without the space predicate a document in space B whose holder
 *    happened to read "Priya" would inflate space A's `document_count` — a cross-space read of a
 *    number, which invariant 4 cares about directly. Here it is not even a guessed uuid: the
 *    attacker's input is a *guessed name*, which is a far shorter guess.
 *  - **`db.$count`, not a hand-written `sql` template** (debt D33). In a select-field position
 *    Drizzle renders columns unqualified, so `sql\`… where ${documents.holder} = ${people.name}\``
 *    becomes `where "holder" = "name"` and resolves `"name"` against `documents`' own columns —
 *    every count silently 0. `documents.file_count` was wrong for the whole of M1 for exactly that.
 *
 * `holder` is nullable, and `eq(null, …)` is NULL rather than true, so a document filed under nobody
 * counts against nobody. That is the correct answer: "Mine" is the *absence* of a holder.
 */
const documentCountSql = db.$count(
  documents,
  and(
    eq(documents.holder, people.name),
    eq(documents.spaceId, people.spaceId),
    isNull(documents.deletedAt),
  ),
)

/** The same count over `things`, with the same space predicate and for the same reason. */
const thingCountSql = db.$count(
  things,
  and(eq(things.holder, people.name), eq(things.spaceId, people.spaceId), isNull(things.deletedAt)),
)

const personColumns = {
  ...getTableColumns(people),
  documentCount: documentCountSql,
  thingCount: thingCountSql,
}

export type PersonRow = typeof people.$inferSelect & {
  documentCount: number
  thingCount: number
}

function select(executor: Executor) {
  return executor.select(personColumns).from(people)
}

/**
 * The whole directory, alphabetical. `personListResponseSchema` has **no cursor** — a household's
 * directory is a handful of names, not a feed (the contract says so and explains why).
 *
 * `id` after `name` so two people with the same name have a stable order rather than whichever one
 * Postgres returns first; ADR-0034 accepts that they are indistinguishable, not that they flicker.
 */
export async function list(actor: ActorContext, executor: Executor = db): Promise<PersonRow[]> {
  return select(executor).where(scoped(actor, people)).orderBy(asc(people.name), asc(people.id))
}

export async function findById(
  actor: ActorContext,
  id: string,
  executor: Executor = db,
): Promise<PersonRow | undefined> {
  // `scoped()` first: a person in another space is not returned at all, which is what makes the
  // service's 404 a 404 rather than a 403 (invariant 4).
  const rows = await select(executor)
    .where(and(scoped(actor, people), eq(people.id, id)))
    .limit(1)

  return rows[0]
}

export type PersonInsert = {
  name: string
  relation: string | null
}

export async function insert(
  actor: ActorContext,
  spaceId: string,
  values: PersonInsert,
  executor: Executor = db,
): Promise<string> {
  const rows = await executor
    .insert(people)
    .values({ ...values, spaceId, createdBy: actor.userId })
    .returning({ id: people.id })

  const id = rows[0]?.id
  if (id === undefined) throw new Error('insert people returned no id')
  return id
}

/**
 * Applies `patch` only if the row is still at `expectedVersion`, bumping the version on success.
 *
 * **The precondition is in the `WHERE`, not in a preceding `SELECT`** — the same shape as
 * `things.repository.update`, and for the same reason: reading the version and then updating leaves
 * a window for another writer to land between the two statements, which is the very race this exists
 * to close. Postgres evaluates both conditions atomically, so the number of rows returned IS the
 * answer.
 *
 * Returns the new version, or `null` when nothing matched. `null` is deliberately ambiguous between
 * "no such person" and "version moved on": only the service knows that distinction is 404 versus 409
 * (ADR-0024), and it has the pre-read row to tell them apart with.
 */
export async function update(
  actor: ActorContext,
  id: string,
  patch: Partial<PersonInsert>,
  expectedVersion: number,
  executor: Executor = db,
): Promise<number | null> {
  const changed = await executor
    .update(people)
    .set({
      ...patch,
      updatedAt: new Date(),
      // `sql` rather than `expectedVersion + 1`, so the increment is relative to the row the
      // database actually matched rather than to a number this process is holding.
      version: sql`${people.version} + 1`,
    })
    .where(and(scoped(actor, people), eq(people.id, id), eq(people.version, expectedVersion)))
    .returning({ version: people.version })

  return changed[0]?.version ?? null
}

/**
 * Soft-deletes the directory row, only if it is still at `expectedVersion` (debt D41).
 *
 * **This touches nothing else, and that is the whole of ADR-0034's remove semantics.** The documents
 * and things filed under this person keep their `holder` string — *"The 4 records filed under them
 * keep the name — they just stop being offered as a choice."* There is deliberately no sibling
 * `clearHolderFor…` function here for a future session to compose in.
 */
export async function softDelete(
  actor: ActorContext,
  id: string,
  expectedVersion: number,
  executor: Executor = db,
): Promise<number | null> {
  const now = new Date()
  const changed = await executor
    .update(people)
    .set({ deletedAt: now, updatedAt: now, version: sql`${people.version} + 1` })
    .where(and(scoped(actor, people), eq(people.id, id), eq(people.version, expectedVersion)))
    .returning({ version: people.version })

  return changed[0]?.version ?? null
}

/**
 * Rewrites `documents.holder` from `fromName` to `toName` across the actor's spaces, returning how
 * many rows moved.
 *
 * `scoped(actor, documents)` is what confines this to the caller's spaces and to live rows — the
 * same helper every read uses, so a rename can no more cross a space boundary than a list can. That
 * is asserted directly: `people.test.ts` renames Priya in one space and checks another space's
 * document filed under "Priya" is untouched.
 *
 * The count is `returning().length` rather than a driver row count, because it is the number the API
 * *reports* (*"Renamed, and 4 records updated"*) and returning the ids makes the claim checkable at
 * the SQL level rather than trusting a field's meaning.
 *
 * `fromName` and `toName` are **bound parameters** — Drizzle's `eq()` and `.set()` both parameterise.
 * Nothing here is concatenated into SQL, which matters more than usual for a column whose values are
 * arbitrary user-typed text.
 */
export async function renameHolderOnDocuments(
  actor: ActorContext,
  fromName: string,
  toName: string,
  executor: Executor = db,
): Promise<number> {
  const changed = await executor
    .update(documents)
    .set({ holder: toName, updatedAt: new Date() })
    .where(and(scoped(actor, documents), eq(documents.holder, fromName)))
    .returning({ id: documents.id })

  return changed.length
}

/**
 * The same rewrite over `things.holder`.
 *
 * Two functions rather than one generic helper over a table parameter: the two tables are only
 * *coincidentally* the same shape, and a shared helper would be the natural place for the next
 * session to add a third table nobody checked. Two explicit statements is also what makes the
 * transaction in `people.service.ts` readable as "these two things happen together".
 *
 * **Neither of these bumps `version`.** A holder rename is not an edit the owner of that document
 * made against a version they read, and bumping it would 409 a form the user has open on a document
 * that merely had a label corrected. The same carve-out `things.repository.updateDerived` documents.
 */
export async function renameHolderOnThings(
  actor: ActorContext,
  fromName: string,
  toName: string,
  executor: Executor = db,
): Promise<number> {
  const changed = await executor
    .update(things)
    .set({ holder: toName, updatedAt: new Date() })
    .where(and(scoped(actor, things), eq(things.holder, fromName)))
    .returning({ id: things.id })

  return changed.length
}

/** Counts live people in the actor's spaces. Used by tests. */
export async function countAll(actor: ActorContext): Promise<number> {
  const rows = await db.select({ total: count() }).from(people).where(scoped(actor, people))
  return rows[0]?.total ?? 0
}
