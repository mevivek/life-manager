import type {
  CreatePerson,
  Person,
  PersonListResponse,
  RenamedResponse,
  UpdatePerson,
} from '@life-manager/shared'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import type { PersonRow } from './people.repository.js'
import * as repository from './people.repository.js'

/**
 * Business rules for People. Decided by
 * [ADR-0034](../../../../../docs/decisions/0034-people-is-a-directory.md), which is the authority —
 * this file implements it and does not restate it.
 *
 * Owns transactions (conventions/code.md §8). **Knows nothing about HTTP** — no reply, no status
 * codes, only typed domain errors that `lib/problem.ts` maps.
 *
 * The domain is three sentences long, and two of them are about what does NOT happen:
 *
 *  1. **Rename propagates.** Changing `name` rewrites `documents.holder` and `things.holder` for
 *     every live row in the space that matched the OLD name — in one transaction, and it reports how
 *     many of each moved.
 *  2. **Remove does not propagate.** Soft-deleting a person leaves every record's `holder` string
 *     exactly as it was. The name simply stops being offered.
 *  3. **Nothing points at this table.** No `person_id`, so nothing here cascades, nulls, or blocks.
 */

/**
 * The space a write lands in. Same function, same reasoning, as `documents.service.ts` and
 * `things.service.ts` — at M1 every actor has exactly one space and this is the single place M3 has
 * to change.
 */
function writeSpaceOf(actor: ActorContext): string {
  const spaceId = actor.spaceIds[0]
  if (spaceId === undefined) {
    // The actor hook self-heals a spaceless user, so reaching here means that failed.
    throw new ValidationError('You do not belong to a space yet.')
  }
  return spaceId
}

/**
 * `relation` normalised to `null` when it is absent or blank.
 *
 * Trimmed already by `createPersonSchema` / `updatePersonSchema`, so this only has to fold `''` and
 * `undefined` into `null`: a relation of empty string would render as *"Priya · "* on the detail
 * screen and would be a second value meaning "none" for every read to know about.
 *
 * Unlike `documents.service.ts`'s `holderColumns`, there is no pair to keep in step here — the
 * person IS the name, so a relation cannot outlive the thing it qualifies.
 */
function relationColumn(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    space_id: row.spaceId,
    name: row.name,
    relation: row.relation,
    document_count: row.documentCount,
    thing_count: row.thingCount,
    version: row.version,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

/**
 * The whole directory, with `document_count` and `thing_count` computed in SQL.
 *
 * **The counts are not this list's only source of names.** ADR-0034: `GET /documents/holders` still
 * derives names from the records themselves, so a holder typed at capture before anyone was added to
 * People is still offered. The Whose sheet unions the two — that is a client concern, and neither
 * endpoint changes because of the other.
 */
export async function list(actor: ActorContext): Promise<PersonListResponse> {
  const rows = await repository.list(actor)
  return { data: rows.map(toPerson) }
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * **One required field.** `createPersonSchema` demands a name and nothing else — Q2 applied to a
 * third domain (ADR-0030), and what *"Add someone"* needs to be a single tap plus a word.
 *
 * A person may exist with nothing filed under them. That is precisely the case
 * `SELECT DISTINCT holder` could not express, and the reason this table exists at all.
 */
export async function create(actor: ActorContext, input: CreatePerson): Promise<Person> {
  const spaceId = writeSpaceOf(actor)

  const id = await repository.insert(actor, spaceId, {
    name: input.name,
    relation: relationColumn(input.relation),
  })

  const created = await repository.findById(actor, id)
  if (created === undefined) throw new Error('person vanished immediately after creation')
  return toPerson(created)
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  THE RENAME. One transaction, three statements, and the only place the two halves meet.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * *"Renaming someone renames them everywhere they're filed."* — the comp, and the sentence
 * ADR-0034 says is only satisfiable without a foreign key.
 *
 * Concretely: the person row moves to the new name, and **in the same transaction** every live
 * document and thing in the actor's spaces whose `holder` equals the OLD name moves with it. The
 * counts come back on the response because the client cannot compute them — the rows changed are in
 * two other domains and may not be loaded (`renamedResponseSchema` says so).
 *
 * ── Why one transaction and not three requests ──
 *
 * A rename that renamed the person and then failed halfway through the documents would leave the
 * directory disagreeing with the filings, with no way to tell which half ran. ADR-0034 accepts that
 * a rename is *not atomic with respect to readers* — a client mid-page-load can see a mix — but the
 * database is never inconsistent.
 *
 * ── Order matters, and this is the order ──
 *
 * The conditional person update goes **first**, so a stale `version` costs nothing: the 409 is thrown
 * before a single `holder` has been rewritten, and the transaction rolls back with the tables
 * untouched. Doing the bulk updates first would mean rewriting thousands of rows and then discarding
 * them. `oldName` is captured from the pre-read row before anything is written, which is what the
 * `WHERE holder = oldName` clauses match on.
 *
 * ── An unchanged name is not a rename ──
 *
 * `{ version, relation: 'Wife' }`, or a `name` equal to the current one, reports `0` and `0` and
 * issues no bulk update at all. Not merely an optimisation: `UPDATE … SET holder = 'Priya' WHERE
 * holder = 'Priya'` would report every record as "updated", so the app would say *"and 4 records
 * updated"* about a rename that changed nothing.
 */
export async function update(
  actor: ActorContext,
  id: string,
  patch: UpdatePerson,
): Promise<RenamedResponse> {
  // Read before the conditional write, so a miss can be explained as 404 or 409. Cross-space is
  // already `undefined` here — `scoped()` filtered it — so this is the 404, never a 403 (invariant 4).
  const existing = await repository.findById(actor, id)
  if (existing === undefined) throw new NotFoundError('No such person.')

  const oldName = existing.name
  // Trimmed by `updatePersonSchema`; absent means "do not change" (conventions/api.md §8).
  const newName = patch.name ?? oldName
  const nameChanged = newName !== oldName

  const values: Partial<repository.PersonInsert> = {
    ...(patch.name === undefined ? {} : { name: newName }),
    ...('relation' in patch ? { relation: relationColumn(patch.relation) } : {}),
  }

  return db.transaction(async (transaction) => {
    const newVersion = await repository.update(actor, id, values, patch.version, transaction)

    /**
     * `null` means the conditional update matched nothing, which is either "gone" or "moved on". We
     * read the row above, so its version is the discriminator (ADR-0024):
     *
     *  - a different version ⇒ somebody else wrote first ⇒ **409**, and the client resolves it
     *  - otherwise ⇒ the row was deleted between our read and our write ⇒ **404**
     *
     * Thrown inside the transaction on purpose: it rolls back, so a refused rename cannot have
     * touched a single `holder`.
     */
    if (newVersion === null) {
      if (existing.version !== patch.version) {
        throw new ConflictError(
          `This was changed elsewhere. You edited version ${patch.version}; it is now at version ${existing.version}.`,
        )
      }
      throw new NotFoundError('No such person.')
    }

    const documentsUpdated = nameChanged
      ? await repository.renameHolderOnDocuments(actor, oldName, newName, transaction)
      : 0
    const thingsUpdated = nameChanged
      ? await repository.renameHolderOnThings(actor, oldName, newName, transaction)
      : 0

    /**
     * Re-read **inside** the transaction, after the bulk updates, so `document_count` and
     * `thing_count` are counted against the new name rather than the old one. Reading it outside
     * would usually agree and would be a different query against a different snapshot — the kind of
     * difference that only shows up under concurrency.
     */
    const updated = await repository.findById(actor, id, transaction)
    if (updated === undefined) throw new NotFoundError('No such person.')

    return {
      person: toPerson(updated),
      documents_updated: documentsUpdated,
      things_updated: thingsUpdated,
    }
  })
}

/**
 * *"Removing them leaves the documents alone."*
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This deliberately touches NOTHING but the `people` row. Do not "finish" it.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Every record filed under this person keeps its `holder` string — *"The 4 records filed under them
 * keep the name — they just stop being offered as a choice."* Clearing them would be the `SET NULL`
 * behaviour ADR-0034 rejected a foreign key for, reimplemented by hand.
 *
 * **No transaction**, and that is a decision rather than an omission: this is a single conditional
 * statement, which Postgres evaluates atomically, so a `BEGIN` around it would buy a round trip and
 * nothing else. The shape difference from `things.service.remove` — which wraps its delete because
 * it also unlinks documents and soft-deletes two child tables — is exactly the difference this ADR
 * is about. `people.test.ts` asserts the documents still read the old name afterwards.
 *
 * `?version=` is required for the same reason a thing's delete requires it (debt D41): a delete built
 * against stale data is refused rather than allowed to destroy an edit made elsewhere, and this app
 * has no restore endpoint.
 */
export async function remove(
  actor: ActorContext,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const existing = await repository.findById(actor, id)
  if (existing === undefined) throw new NotFoundError('No such person.')

  const newVersion = await repository.softDelete(actor, id, expectedVersion)

  if (newVersion === null) {
    if (existing.version !== expectedVersion) {
      throw new ConflictError(
        `This was changed elsewhere after you loaded it. You tried to remove version ${expectedVersion}; it is now at version ${existing.version}. Open it and check before removing.`,
      )
    }
    throw new NotFoundError('No such person.')
  }
}
