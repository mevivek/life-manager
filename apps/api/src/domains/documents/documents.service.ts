import {
  AUTO_REMINDER_TYPES,
  DEFAULT_LEAD_DAYS,
  type Document,
  type DocumentCreate,
  type DocumentDetailResponse,
  type DocumentFile,
  type DocumentListQuery,
  type DocumentListResponse,
  type DocumentType,
  type DocumentUpdate,
  type Reminder,
  truncateToLast4,
  validateCustomAttrs,
} from '@life-manager/shared'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { type Cursor, decodeCursor, toPage } from '../../lib/cursor.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import type { ReminderRow } from '../reminders/reminders.repository.js'
import * as remindersRepository from '../reminders/reminders.repository.js'
import type { DocumentFileRow, DocumentRow } from './documents.repository.js'
import * as repository from './documents.repository.js'

/**
 * Business rules for Documents. domains/documents.md §4 — each numbered rule below cites the
 * rule it implements, so a review can check them off mechanically.
 *
 * Owns transactions (conventions/code.md §8). **Knows nothing about HTTP** — no reply, no status
 * codes, only typed domain errors that `lib/problem.ts` maps.
 */

/**
 * The space a write lands in.
 *
 * At M1 every actor has exactly one space, so this is unambiguous. It is a named function rather
 * than an inline `actor.spaceIds[0]` because M3 makes it a real decision — and open question Q6
 * (`ActorContext.role` scalar vs per-space) is the same question wearing a different hat. When Q6
 * is answered, this is the one place that changes.
 */
function writeSpaceOf(actor: ActorContext): string {
  const spaceId = actor.spaceIds[0]
  if (spaceId === undefined) {
    // The actor hook self-heals a spaceless user, so reaching here means that failed.
    throw new ValidationError('You do not belong to a space yet.')
  }
  return spaceId
}

/** Business rule 2: `expires_on`, when present, must be on or after `issued_on`. */
function assertDateOrder(issuedOn: string | null, expiresOn: string | null): void {
  if (issuedOn === null || expiresOn === null) return
  // Both are `YYYY-MM-DD`, so a lexicographic comparison is a date comparison. No Date objects,
  // and therefore no timezone to get wrong (conventions/data.md §4).
  if (expiresOn < issuedOn) {
    throw new ValidationError('An expiry date cannot be before the issue date.')
  }
}

/**
 * Validates `custom_attrs` against the **effective** `doc_type` — the type the document will have
 * once the patch is applied, not the one it had before. Getting this backwards would let a PATCH
 * that switches `identity` → `warranty` keep identity-only keys.
 */
function parseCustomAttrs(docType: DocumentType, attrs: Record<string, unknown>) {
  const result = validateCustomAttrs(docType, attrs)
  if (!result.ok) {
    const detail = result.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')
    throw new ValidationError(`custom_attrs does not match doc_type "${docType}" — ${detail}`)
  }
  return result.value
}

function toDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    space_id: row.spaceId,
    title: row.title,
    doc_type: row.docType,
    issuer: row.issuer,
    /** Whose document it is — `null` means the owner's own. A label, never a permission. */
    holder: row.holder,
    relation: row.relation,
    /**
     * The full identifier, on every document response including the list — ADR-0027.
     *
     * ADR-0026 kept this off `toDocument` on purpose, so it could not leak into a list by someone
     * adding a field to the shared mapper. ADR-0027 reverses that deliberately: the archive is where
     * a person goes when they need a number, and a detail round-trip on a cold-starting API is
     * seconds of standing at a counter. The cost — the persisted cache now holds every number on the
     * device — is stated in ADR-0027 and tracked as debt D47.
     */
    identifier: row.identifier,
    identifier_last4: row.identifierLast4,
    issued_on: row.issuedOn,
    expires_on: row.expiresOn,
    country: row.country,
    notes: row.notes,
    tags: row.tags,
    custom_attrs: row.customAttrs,
    file_count: row.fileCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  }
}

function toFile(row: DocumentFileRow): DocumentFile {
  return {
    id: row.id,
    document_id: row.documentId,
    version: row.version,
    mime: row.mime,
    size_bytes: row.sizeBytes,
    sha256: row.sha256 ?? '',
    is_primary: row.isPrimary,
    uploaded_at: row.uploadedAt === null ? null : row.uploadedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    // `storage_key` is deliberately absent from the response schema — invariant 6.
  }
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    entity_type: 'document',
    entity_id: row.entityId,
    due_on: row.dueOn,
    lead_days: row.leadDays,
    channel: row.channel,
    sent_at: row.sentAt === null ? null : row.sentAt.toISOString(),
    dismissed_at: row.dismissedAt === null ? null : row.dismissedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  }
}

export async function list(
  actor: ActorContext,
  query: DocumentListQuery,
): Promise<DocumentListResponse> {
  const cursor: Cursor | null = query.cursor === undefined ? null : decodeCursor(query.cursor)
  const rows = await repository.list(actor, query, cursor)

  const page = toPage(rows, query.limit, (row) => ({
    sortValue: repository.cursorValueOf(row, query.sort),
    id: row.id,
  }))

  return { data: page.data.map(toDocument), next_cursor: page.next_cursor }
}

export async function getDetail(actor: ActorContext, id: string): Promise<DocumentDetailResponse> {
  const row = await repository.findById(actor, id)
  // Business rule 12 / invariant 4: a document in another space is indistinguishable from one
  // that does not exist. `scoped()` already returned nothing; this is the 404, never a 403.
  if (row === undefined) throw new NotFoundError('No such document.')

  const [files, reminders] = await Promise.all([
    repository.listFiles(actor, id),
    remindersRepository.listForEntity(actor, id),
  ])

  return {
    // `identifier` comes from `toDocument` now — ADR-0027 moved it onto `documentSchema`, so the
    // detail response inherits it rather than spreading it in separately.
    ...toDocument(row),
    files: files.map(toFile),
    reminders: reminders.map(toReminder),
  }
}

/**
 * Both identifier columns, from one input value — the only place either is written.
 *
 * `identifier_last4` is **derived**, never supplied: a client cannot send a mask that disagrees with
 * the number it masks. Keeping the derivation in one function used by both create and update is what
 * stops the two drifting, which is the failure mode where an edit updates the full value and leaves
 * yesterday's last four on the row for every list to render.
 *
 * Trimmed first, because a number typed on a phone arrives with a trailing space more often than not
 * and the mask is taken from the *end* of the string — so an untrimmed value would mask to " 109 "
 * rather than "8109", visibly wrong in the one place the mask is shown.
 *
 * An empty string collapses to `null` rather than being stored. `identifierInputSchema` is `min(1)`,
 * so the wire rejects `''` before it arrives and `DocumentForm` maps a blank field to `null` anyway —
 * this branch is for a value that trims down to nothing (`"   "`), which passes `min(1)` and is not an
 * identifier.
 */
function identifierColumns(value: string | null | undefined): {
  identifier: string | null
  identifierLast4: string | null
} {
  if (value === null || value === undefined) return { identifier: null, identifierLast4: null }
  const trimmed = value.trim()
  if (trimmed === '') return { identifier: null, identifierLast4: null }
  return { identifier: trimmed, identifierLast4: truncateToLast4(trimmed) }
}

/**
 * Both holder columns, from one pair of inputs — the only place either is written.
 *
 * **A relation with no holder is discarded.** "Wife" on a document with no name attached is a label
 * for nobody: the detail screen would read "Mine · Wife", and the people picker has no person to
 * suggest it against. So clearing the holder clears the relation with it, in one place rather than at
 * each of the two call sites.
 *
 * Trimming is the schema's job (`holderSchema`), not this function's — but a value that trims to
 * nothing still has to become `null`, or the column holds `''` and `?holder=<name>` can never match it
 * while `?holder=mine` has to special-case it.
 */
function holderColumns(
  holder: string | null | undefined,
  relation: string | null | undefined,
): { holder: string | null; relation: string | null } {
  const name = holder == null || holder.trim() === '' ? null : holder.trim()
  if (name === null) return { holder: null, relation: null }
  const how = relation == null || relation.trim() === '' ? null : relation.trim()
  return { holder: name, relation: how }
}

/**
 * Business rule 1 (title required, everything else optional), 2 (date order), 6 (identifier
 * stored in full, masked for display — ADR-0026), 8 (default reminders for identity and
 * certificate types).
 *
 * One transaction, because rule 8's reminders must not survive a rolled-back document — that is
 * the "enqueue inside the transaction" rule from ADR-0012 applied to rows rather than jobs.
 */
export async function create(actor: ActorContext, input: DocumentCreate): Promise<Document> {
  const spaceId = writeSpaceOf(actor)

  const issuedOn = input.issued_on ?? null
  const expiresOn = input.expires_on ?? null
  assertDateOrder(issuedOn, expiresOn)

  const customAttrs = parseCustomAttrs(input.doc_type, input.custom_attrs)

  const id = await db.transaction(async (tx) => {
    const documentId = await repository.insert(
      actor,
      spaceId,
      {
        title: input.title,
        docType: input.doc_type,
        issuer: input.issuer ?? null,
        // Business rule 6 as revised by ADR-0026: the full value is stored, and the mask derived
        // from it in the same breath.
        ...identifierColumns(input.identifier),
        ...holderColumns(input.holder, input.relation),
        issuedOn,
        expiresOn,
        country: input.country ?? null,
        notes: input.notes ?? null,
        tags: input.tags,
        customAttrs,
      },
      tx,
    )

    await createDefaultReminders(actor, spaceId, documentId, input.doc_type, expiresOn, tx)

    return documentId
  })

  const created = await repository.findById(actor, id)
  if (created === undefined) throw new Error('document vanished immediately after creation')
  return toDocument(created)
}

/**
 * Business rule 8: default lead times of 90, 30 and 7 days, **only** for `identity` and
 * `certificate` — the types with painful renewal timelines. Silent for everything else, and
 * silent when there is no expiry date, which is Q1's answer (expiry-only reminders).
 */
async function createDefaultReminders(
  actor: ActorContext,
  spaceId: string,
  documentId: string,
  docType: DocumentType,
  expiresOn: string | null,
  tx: repository.Executor,
): Promise<void> {
  if (expiresOn === null) return
  if (!AUTO_REMINDER_TYPES.includes(docType)) return

  for (const leadDays of DEFAULT_LEAD_DAYS) {
    await remindersRepository.insert(
      actor,
      spaceId,
      { entityId: documentId, dueOn: expiresOn, leadDays, channel: 'web_push' },
      tx,
    )
  }
}

/**
 * Business rules 2, 6, 7. `PATCH` semantics per conventions/api.md §8: an absent key means "don't
 * change", an explicit `null` means "clear".
 */
export async function update(
  actor: ActorContext,
  id: string,
  patch: DocumentUpdate,
): Promise<Document> {
  const existing = await repository.findById(actor, id)
  if (existing === undefined) throw new NotFoundError('No such document.')

  // The effective values after the patch, needed for the cross-field rules below.
  const issuedOn = 'issued_on' in patch ? (patch.issued_on ?? null) : existing.issuedOn
  const expiresOn = 'expires_on' in patch ? (patch.expires_on ?? null) : existing.expiresOn
  const docType = patch.doc_type ?? existing.docType

  assertDateOrder(issuedOn, expiresOn)

  const customAttrs =
    patch.custom_attrs === undefined
      ? // The type may have changed without `custom_attrs` being sent. Re-validate what is
        // already stored against the NEW type, so switching type cannot leave stale keys behind.
        parseCustomAttrs(docType, existing.customAttrs)
      : parseCustomAttrs(docType, patch.custom_attrs)

  const values: Partial<repository.DocumentInsert> = {
    ...(patch.title === undefined ? {} : { title: patch.title }),
    ...(patch.doc_type === undefined ? {} : { docType: patch.doc_type }),
    ...('issuer' in patch ? { issuer: patch.issuer ?? null } : {}),
    // Both columns move together or neither does — see `identifierColumns`.
    ...('identifier' in patch ? identifierColumns(patch.identifier) : {}),
    /**
     * `holder` and `relation` also move together, and a patch that mentions either resolves both —
     * otherwise clearing the holder alone would leave "Wife" attached to a document that is now the
     * owner's own. See `holderColumns`.
     */
    ...('holder' in patch || 'relation' in patch
      ? holderColumns(
          'holder' in patch ? patch.holder : existing.holder,
          'relation' in patch ? patch.relation : existing.relation,
        )
      : {}),
    ...('issued_on' in patch ? { issuedOn } : {}),
    ...('expires_on' in patch ? { expiresOn } : {}),
    ...('country' in patch ? { country: patch.country ?? null } : {}),
    ...('notes' in patch ? { notes: patch.notes ?? null } : {}),
    ...(patch.tags === undefined ? {} : { tags: patch.tags }),
    customAttrs,
  }

  const expiryChanged = 'expires_on' in patch && expiresOn !== existing.expiresOn

  await db.transaction(async (tx) => {
    const newVersion = await repository.update(actor, id, values, patch.version, tx)

    /**
     * `null` means the conditional update matched nothing, which is either "gone" or "moved on".
     * We already read the row above, so the version is the discriminator (ADR-0024):
     *
     *  - a different version ⇒ somebody else wrote first ⇒ **409**, and the client resolves it
     *  - otherwise ⇒ the row was deleted between our read and our write ⇒ **404**
     *
     * The 409 carries the current version so the client can re-read and retry without guessing.
     */
    if (newVersion === null) {
      if (existing.version !== patch.version) {
        throw new ConflictError(
          `This document was changed elsewhere. You edited version ${patch.version}; it is now at version ${existing.version}.`,
        )
      }
      throw new NotFoundError('No such document.')
    }

    /**
     * Business rule 7: setting or changing `expires_on` reconciles pending reminders; clearing it
     * deletes them.
     *
     * Reconciliation is delete-then-recreate rather than an in-place date update. That is
     * deliberate: a user may have added their own reminders at custom lead times, and there is no
     * way to tell those apart from the automatic ones without another column. Rebuilding from the
     * rule is predictable, and only *pending* reminders are touched — anything already sent is
     * history and stays (see `softDeletePendingFor`).
     */
    if (expiryChanged) {
      await remindersRepository.softDeletePendingFor(actor, id, tx)
      if (expiresOn !== null) {
        await createDefaultReminders(actor, writeSpaceOf(actor), id, docType, expiresOn, tx)
      }
    }
  })

  const updated = await repository.findById(actor, id)
  if (updated === undefined) throw new NotFoundError('No such document.')
  return toDocument(updated)
}

/**
 * Business rule 9: soft-deletes the document, its files and its reminders — and **does not delete
 * the R2 objects**. Object cleanup is a separate job so an accidental delete stays recoverable
 * (conventions/data.md §3, ADR-0008).
 */
export async function remove(
  actor: ActorContext,
  id: string,
  expectedVersion: number,
): Promise<void> {
  // Read before the conditional delete, so a miss can be explained. Same shape as `update`.
  const existing = await repository.findById(actor, id)
  if (existing === undefined) throw new NotFoundError('No such document.')

  await db.transaction(async (tx) => {
    const newVersion = await repository.softDelete(actor, id, expectedVersion, tx)

    /**
     * Nothing matched: either the row is gone, or it moved on. Debt D41 — before this precondition
     * existed, a delete built against a stale read destroyed whatever had been written since, with
     * no conflict shown. A delete is unrecoverable in this app (there is no restore endpoint), which
     * makes it the write where a lost update matters most, not least.
     */
    if (newVersion === null) {
      if (existing.version !== expectedVersion) {
        throw new ConflictError(
          `This document was changed elsewhere after you loaded it. You tried to delete version ${expectedVersion}; it is now at version ${existing.version}. Open it and check before deleting.`,
        )
      }
      throw new NotFoundError('No such document.')
    }

    await repository.softDeleteFilesFor(actor, id, tx)
    await remindersRepository.softDeletePendingFor(actor, id, tx)
  })
}

/** Distinct holders with their most recent relation — for the people picker. */
export async function listHolders(
  actor: ActorContext,
): Promise<{ holder: string; relation: string | null }[]> {
  return repository.distinctHolders(actor)
}

/** Distinct issuers for autocomplete — spec §9 question 1's "free text plus autocomplete". */
export async function listIssuers(actor: ActorContext): Promise<string[]> {
  return repository.distinctIssuers(actor)
}
