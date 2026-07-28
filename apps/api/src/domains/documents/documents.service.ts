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
import { NotFoundError, ValidationError } from '../../lib/errors.js'
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
    ...toDocument(row),
    files: files.map(toFile),
    reminders: reminders.map(toReminder),
  }
}

/**
 * Business rule 1 (title required, everything else optional), 2 (date order), 6 (identifier
 * truncated), 8 (default reminders for identity and certificate types).
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
        // Business rule 6: the full value never reaches the column.
        identifierLast4:
          input.identifier === null || input.identifier === undefined
            ? null
            : truncateToLast4(input.identifier),
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
    ...('identifier' in patch
      ? {
          identifierLast4:
            patch.identifier === null || patch.identifier === undefined
              ? null
              : truncateToLast4(patch.identifier),
        }
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
    const changed = await repository.update(actor, id, values, tx)
    if (changed === 0) throw new NotFoundError('No such document.')

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
export async function remove(actor: ActorContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const changed = await repository.softDelete(actor, id, tx)
    if (changed === 0) throw new NotFoundError('No such document.')

    await repository.softDeleteFilesFor(actor, id, tx)
    await remindersRepository.softDeletePendingFor(actor, id, tx)
  })
}

/** Distinct issuers for autocomplete — spec §9 question 1's "free text plus autocomplete". */
export async function listIssuers(actor: ActorContext): Promise<string[]> {
  return repository.distinctIssuers(actor)
}
