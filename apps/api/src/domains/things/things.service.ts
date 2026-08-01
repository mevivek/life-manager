import type {
  LinkedDocument,
  Reminder,
  Thing,
  ThingCreate,
  ThingDetailResponse,
  ThingListQuery,
  ThingListResponse,
  ThingPhoto,
  ThingService,
  ThingServiceCreate,
  ThingUpdate,
} from '@life-manager/shared'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { type Cursor, decodeCursor, toPage } from '../../lib/cursor.js'
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js'
import * as documentsRepository from '../documents/documents.repository.js'
import type { ReminderRow } from '../reminders/reminders.repository.js'
import * as remindersRepository from '../reminders/reminders.repository.js'
import { THING_ENTITY_TYPE } from '../reminders/reminders.repository.js'
import type { ThingPhotoRow, ThingRow, ThingServiceRow } from './things.repository.js'
import * as repository from './things.repository.js'

/**
 * Business rules for Things. domains/things.md §4 — each numbered rule below cites the rule it
 * implements, so a review can check the list off mechanically rather than reading for coverage.
 *
 * Owns transactions (conventions/code.md §8). **Knows nothing about HTTP** — no reply, no status
 * codes, only typed domain errors that `lib/problem.ts` maps.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Three "moves together" rules, and each one is a helper rather than a rule in prose.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `serialColumns`, `holderColumns` and `ownershipColumns` each write **every** column of a group
 * from one call, so a patch that mentions one member of the group cannot leave another behind. All
 * three are the same shape as `documents.service.ts`'s `identifierColumns`/`holderColumns`, for the
 * same reason: the failure mode is silent and only visible in a list.
 */

/**
 * The space a write lands in. Same function, same reasoning, as `documents.service.ts` — at M1 every
 * actor has exactly one space and this is the single place M3 has to change.
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
 * The serial column, from one input value — business rule 7, and **the only place it is written**.
 *
 * **This used to return two columns**, deriving `serial_last4` beside the value so a client could not
 * send a mask that disagreed with what it masked. ADR-0034 dropped that column; the mask is cut
 * client-side from the same value, which cannot disagree with itself.
 *
 * Trimmed, because a tail comes off the **end** of the string and a serial typed on a phone arrives
 * with a trailing space more often than not — an untrimmed `"…1234 "` would draw as `"234 "`. A value
 * that trims to nothing becomes `null` rather than `''`: `serialInputSchema` is `min(1)` so the wire
 * rejects an empty string, but `"   "` passes that and is not a serial.
 */
function serialColumns(value: string | null | undefined): { serial: string | null } {
  if (value === null || value === undefined) return { serial: null }
  const trimmed = value.trim()
  return { serial: trimmed === '' ? null : trimmed }
}

/**
 * Both holder columns — business rule 6, and identical to the documents helper of the same name.
 * documents.md §4 rule 13 is the authority on the semantics; read it there.
 *
 * **A relation with no holder is discarded**, because "Wife" attached to nobody is a label for
 * nobody: the detail screen would read "Mine · Wife" and the people picker has no person to suggest
 * it against.
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
 * The ownership **triple**, from one call — business rule 4's third consequence.
 *
 * *"`ownership_who` and `ownership_since` cannot outlive `ownership`. Returning a thing to `here`
 * clears both in the same statement, for the same reason `relation` cannot outlive `holder`."*
 *
 * ── Why this is here and not a `.refine()` on the schema ──
 *
 * `thingUpdateSchema`'s own comment says so explicitly: a refine could only **reject** the bad
 * combination, and the useful behaviour is to **fix** it. A user tapping "It's back with me" is not
 * making a mistake that deserves a 422; they are performing the transition that, by definition,
 * ends the loan. So `{ ownership: 'here' }` alone is a complete, valid patch and the other two
 * columns follow it to null.
 *
 * The non-`here` branch passes values through rather than requiring them: rule 4 says
 * `ownership_who` is *"free text, optional even when not `here`"* — you can record that a thing is
 * lent without naming who has it.
 */
function ownershipColumns(
  ownership: 'here' | 'lent' | 'gone',
  who: string | null | undefined,
  since: string | null | undefined,
): {
  ownership: 'here' | 'lent' | 'gone'
  ownershipWho: string | null
  ownershipSince: string | null
} {
  if (ownership === 'here') {
    return { ownership, ownershipWho: null, ownershipSince: null }
  }
  const name = who == null || who.trim() === '' ? null : who.trim()
  return { ownership, ownershipWho: name, ownershipSince: since ?? null }
}

/**
 * `serviced_on` plus `n` months, clamped to the end of the target month — business rule 3.
 *
 * **Not `new Date(y, m + n, d)`.** JavaScript *overflows* a short month: 31 January plus one month
 * is 3 March in a leap year and 2 March otherwise, so a monthly service logged on the 31st would
 * drift a couple of days forward every cycle. Postgres's `date + interval '1 month'` clamps to
 * 28 February instead, and this function matches Postgres rather than JavaScript — because the
 * seeded `service_due_on` a user typed and the recomputed one must be the same kind of date.
 *
 * All strings, all `YYYY-MM-DD`, no `Date` objects and therefore no timezone to get wrong
 * (conventions/data.md §4). Doing this arithmetic in SQL would have been equally correct and would
 * have put a business rule in the repository, which conventions/code.md §1 forbids.
 */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [yearPart, monthPart, dayPart] = isoDate.split('-')
  const year = Number(yearPart)
  const month = Number(monthPart)
  const day = Number(dayPart)
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error(`addMonthsClamped: not an ISO date: ${isoDate}`)
  }

  // Months are 1-based on the wire and 0-based in this arithmetic; `zeroBased` keeps the two
  // conversions adjacent so an off-by-one is visible rather than buried in an expression.
  const zeroBased = month - 1 + months
  const targetYear = year + Math.floor(zeroBased / 12)
  const targetMonth = ((zeroBased % 12) + 12) % 12

  // Day 0 of the following month IS the last day of the target month, which is how the clamp avoids
  // hard-coding month lengths and leap years.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
  const clamped = Math.min(day, lastDay)

  const mm = String(targetMonth + 1).padStart(2, '0')
  const dd = String(clamped).padStart(2, '0')
  return `${targetYear}-${mm}-${dd}`
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toThing(row: ThingRow): Thing {
  return {
    id: row.id,
    space_id: row.spaceId,
    name: row.name,
    kind: row.kind,
    brand: row.brand,
    model: row.model,
    /**
     * The **full** serial, on every response including the list — ADR-0027's argument for a
     * document's identifier, applied to this column by `thingSchema`. The cost is the same and it is
     * real: the persisted Query cache writes list responses to IndexedDB, so a phone that has opened
     * Things holds every serial in plaintext. Debt **D47**, widened.
     */
    serial: row.serial,
    purchased_on: row.purchasedOn,
    price: row.price,
    currency: row.currency,
    warranty_ends_on: row.warrantyEndsOn,
    service_every_months: row.serviceEveryMonths,
    service_due_on: row.serviceDueOn,
    kept_at: row.keptAt,
    holder: row.holder,
    relation: row.relation,
    ownership: row.ownership,
    ownership_who: row.ownershipWho,
    ownership_since: row.ownershipSince,
    notes: row.notes,
    document_count: row.documentCount,
    photo_count: row.photoCount,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    version: row.version,
  }
}

function toService(row: ThingServiceRow): ThingService {
  return {
    id: row.id,
    thing_id: row.thingId,
    serviced_on: row.servicedOn,
    cost: row.cost,
    currency: row.currency,
    provider: row.provider,
    notes: row.notes,
    created_at: row.createdAt.toISOString(),
  }
}

function toPhoto(row: ThingPhotoRow): ThingPhoto {
  return {
    id: row.id,
    thing_id: row.thingId,
    mime: row.mime,
    size_bytes: row.sizeBytes,
    sha256: row.sha256,
    is_hero: row.isHero,
    uploaded_at: row.uploadedAt === null ? null : row.uploadedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    // `storage_key` is deliberately absent from the response schema — invariant 6.
  }
}

function toReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    // `'thing'`, and this is the reason `reminderSchema.entity_type` is an enum rather than the
    // literal `'document'` it used to be — see the note in `packages/shared/src/reminders.ts`.
    entity_type: THING_ENTITY_TYPE,
    entity_id: row.entityId,
    due_on: row.dueOn,
    lead_days: row.leadDays,
    channel: row.channel,
    sent_at: row.sentAt === null ? null : row.sentAt.toISOString(),
    dismissed_at: row.dismissedAt === null ? null : row.dismissedAt.toISOString(),
    created_at: row.createdAt.toISOString(),
  }
}

function toLinkedDocument(row: {
  id: string
  title: string
  docType: string
  issuer: string | null
  expiresOn: string | null
}): LinkedDocument {
  return {
    id: row.id,
    title: row.title,
    doc_type: row.docType,
    issuer: row.issuer,
    expires_on: row.expiresOn,
  }
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function list(actor: ActorContext, query: ThingListQuery): Promise<ThingListResponse> {
  // The sort option decides how the cursor's sort value is validated, so the two are read together.
  const cursor: Cursor | null =
    query.cursor === undefined
      ? null
      : decodeCursor(query.cursor, repository.cursorSortKind(query.sort))
  const rows = await repository.list(actor, query, cursor)

  const page = toPage(rows, query.limit, (row) => ({
    sortValue: repository.cursorValueOf(row, query.sort),
    id: row.id,
  }))

  return { data: page.data.map(toThing), next_cursor: page.next_cursor }
}

export async function getDetail(actor: ActorContext, id: string): Promise<ThingDetailResponse> {
  const row = await repository.findById(actor, id)
  // Business rule 10 / invariant 4: a thing in another space is indistinguishable from one that
  // does not exist. `scoped()` already returned nothing; this is the 404, never a 403.
  if (row === undefined) throw new NotFoundError('No such thing.')

  const [photos, services, linked, reminders] = await Promise.all([
    repository.listPhotos(actor, id),
    repository.listServices(actor, id),
    documentsRepository.listLinkedToThing(actor, id),
    remindersRepository.listForEntity(actor, THING_ENTITY_TYPE, id),
  ])

  return {
    ...toThing(row),
    photos: photos.map(toPhoto),
    services: services.map(toService),
    documents: linked.map(toLinkedDocument),
    reminders: reminders.map(toReminder),
  }
}

/** Distinct holders with their most recent relation — for the people picker on the thing form. */
export async function listHolders(
  actor: ActorContext,
): Promise<{ holder: string; relation: string | null }[]> {
  return repository.distinctHolders(actor)
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Business rule 1: **`name` is the only required field.** A thing may exist with no kind detail, no
 * price, no cover and no photo — Q2 applied to a second domain, and the promise the capture wizard's
 * *Skip for now* makes visible (ADR-0030).
 *
 * ── No reminders are created here, and that is deliberate ──
 *
 * Documents auto-create 90/30/7-day reminders for `identity` and `certificate` (`AUTO_REMINDER_TYPES`).
 * The equivalent question for things — *should every warranty get a reminder?* — is
 * **things.md §9(2), and it is unanswered.** things.md §6 says in as many words: *"Do not decide it
 * in a repository."* So the capability is built (the table is generic, `THING_ENTITY_TYPE` exists,
 * the detail response carries `reminders[]`) and the switch is left off until a human answers it.
 *
 * A thing is created **`here`**: `thingCreateSchema` has no `ownership` field, because you cannot
 * file something you have already given away and a three-way choice on the fast path would be paid
 * by every capture for a state most things never reach. It moves through `PATCH`.
 */
export async function create(actor: ActorContext, input: ThingCreate): Promise<Thing> {
  const spaceId = writeSpaceOf(actor)

  const id = await repository.insert(actor, spaceId, {
    name: input.name,
    kind: input.kind,
    brand: input.brand ?? null,
    model: input.model ?? null,
    ...serialColumns(input.serial),
    purchasedOn: input.purchased_on ?? null,
    price: input.price ?? null,
    currency: input.currency ?? null,
    warrantyEndsOn: input.warranty_ends_on ?? null,
    serviceEveryMonths: input.service_every_months ?? null,
    /**
     * The seed rule 3 describes: *"a thing with a cycle and an empty log uses its seeded
     * `service_due_on` until the first service is logged."* Accepted verbatim rather than derived,
     * because at capture there is no log to derive from — the user knows when the boiler is next due
     * and the app does not.
     */
    serviceDueOn: input.service_due_on ?? null,
    keptAt: input.kept_at ?? null,
    ...holderColumns(input.holder, input.relation),
    ...ownershipColumns('here', null, null),
    notes: input.notes ?? null,
  })

  const created = await repository.findById(actor, id)
  if (created === undefined) throw new Error('thing vanished immediately after creation')
  return toThing(created)
}

/**
 * `PATCH` semantics per conventions/api.md §8: an absent key means "don't change", an explicit
 * `null` means "clear". Business rules 4, 6 and 7.
 */
export async function update(actor: ActorContext, id: string, patch: ThingUpdate): Promise<Thing> {
  const existing = await repository.findById(actor, id)
  if (existing === undefined) throw new NotFoundError('No such thing.')

  const values: Partial<repository.ThingInsert> = {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.kind === undefined ? {} : { kind: patch.kind }),
    ...('brand' in patch ? { brand: patch.brand ?? null } : {}),
    ...('model' in patch ? { model: patch.model ?? null } : {}),
    // Both serial columns move together or neither does — see `serialColumns`.
    ...('serial' in patch ? serialColumns(patch.serial) : {}),
    ...('purchased_on' in patch ? { purchasedOn: patch.purchased_on ?? null } : {}),
    ...('price' in patch ? { price: patch.price ?? null } : {}),
    ...('currency' in patch ? { currency: patch.currency ?? null } : {}),
    ...('warranty_ends_on' in patch ? { warrantyEndsOn: patch.warranty_ends_on ?? null } : {}),
    ...('service_every_months' in patch
      ? { serviceEveryMonths: patch.service_every_months ?? null }
      : {}),
    ...('service_due_on' in patch ? { serviceDueOn: patch.service_due_on ?? null } : {}),
    ...('kept_at' in patch ? { keptAt: patch.kept_at ?? null } : {}),
    /**
     * A patch mentioning either half of the holder pair resolves both, so clearing the holder alone
     * cannot leave "Wife" attached to a thing that is now the owner's own.
     */
    ...('holder' in patch || 'relation' in patch
      ? holderColumns(
          'holder' in patch ? patch.holder : existing.holder,
          'relation' in patch ? patch.relation : existing.relation,
        )
      : {}),
    /**
     * The ownership triple, likewise — and this is the one that matters most, because returning a
     * thing to `here` MUST clear `ownership_who` and `ownership_since` **in the same statement**
     * (business rule 4). A patch of `{ ownership: 'here' }` alone is the "It's back with me" control.
     */
    ...('ownership' in patch || 'ownership_who' in patch || 'ownership_since' in patch
      ? ownershipColumns(
          patch.ownership ?? existing.ownership,
          'ownership_who' in patch ? patch.ownership_who : existing.ownershipWho,
          'ownership_since' in patch ? patch.ownership_since : existing.ownershipSince,
        )
      : {}),
    ...('notes' in patch ? { notes: patch.notes ?? null } : {}),
  }

  /**
   * No transaction, and that is deliberate rather than an omission.
   *
   * `documents.service.ts` wraps its patch in one because it also reconciles reminder rows, which
   * must not survive a rolled-back document. A thing's patch is a **single conditional statement** —
   * Postgres evaluates it atomically — so a `BEGIN` around it would buy a round trip and nothing
   * else. The shape difference from Documents is a decision; do not "fix" it.
   */
  const newVersion = await repository.update(actor, id, values, patch.version)

  /**
   * `null` means the conditional update matched nothing, which is either "gone" or "moved on". We
   * read the row above, so its version is the discriminator (ADR-0024):
   *
   *  - a different version ⇒ somebody else wrote first ⇒ **409**, and the client resolves it
   *  - otherwise ⇒ the row was deleted between our read and our write ⇒ **404**
   */
  if (newVersion === null) {
    if (existing.version !== patch.version) {
      throw new ConflictError(
        `This was changed elsewhere. You edited version ${patch.version}; it is now at version ${existing.version}.`,
      )
    }
    throw new NotFoundError('No such thing.')
  }

  const updated = await repository.findById(actor, id)
  if (updated === undefined) throw new NotFoundError('No such thing.')
  return toThing(updated)
}

/**
 * Business rule 4 stated from the other side, and business rule 5.
 *
 * Soft-deletes the thing, its service log and its photos; **unlinks its documents without deleting
 * them**. The copy on the delete control promises exactly that — *"Its documents stay in Documents —
 * deleting the thing doesn't shred the paperwork"* — and a `cascade` on `documents.thing_id` would
 * have made it a lie. The foreign key is `on delete set null` for the same reason, which covers a
 * hard purge; this covers the soft delete a user can actually perform (conventions/data.md §3).
 *
 * The stored photo objects are deliberately left in R2, exactly as a document's files are (ADR-0008):
 * object cleanup is a separate job, so an accidental delete stays recoverable.
 */
export async function remove(
  actor: ActorContext,
  id: string,
  expectedVersion: number,
): Promise<void> {
  // Read before the conditional delete, so a miss can be explained. Same shape as `update`.
  const existing = await repository.findById(actor, id)
  if (existing === undefined) throw new NotFoundError('No such thing.')

  await db.transaction(async (transaction) => {
    const newVersion = await repository.softDelete(actor, id, expectedVersion, transaction)

    /**
     * Debt D41's rule applied to the second domain: a delete built against a stale read is refused
     * rather than allowed to destroy whatever landed since. A delete is unrecoverable in this app —
     * there is no restore endpoint — which makes it the write where a lost update matters most.
     */
    if (newVersion === null) {
      if (existing.version !== expectedVersion) {
        throw new ConflictError(
          `This was changed elsewhere after you loaded it. You tried to delete version ${expectedVersion}; it is now at version ${existing.version}. Open it and check before deleting.`,
        )
      }
      throw new NotFoundError('No such thing.')
    }

    await repository.softDeleteServicesFor(actor, id, transaction)
    await repository.softDeletePhotosFor(actor, id, transaction)
    // Rule 5. In the same transaction, so a rolled-back delete cannot leave documents unlinked from
    // a thing that still exists.
    await documentsRepository.unlinkFromThing(actor, id, transaction)
  })
}

// ── The service log ──────────────────────────────────────────────────────────

/**
 * Business rule 3: **a service is a cycle, not a date.**
 *
 * Logging one inserts a `thing_services` row and **recomputes** `service_due_on` as
 * `serviced_on + service_every_months`. The client deliberately does not send a next date — a cycle
 * whose next date is client-computed is a cycle two devices can disagree about, and the server is
 * authoritative (invariant 5).
 *
 * A thing with `service_every_months IS NULL` has **no cycle and no due date**, so logging a service
 * on one records the history and leaves `service_due_on` alone. That is the case the test names, and
 * it is why the recompute is conditional rather than a `?? 0` waiting to produce a due date of
 * "today".
 *
 * One transaction: the insert and the recompute are one fact about the thing, and a log entry whose
 * due date failed to move would be worse than no entry at all.
 *
 * **The recompute deliberately does not carry a version precondition.** `service_due_on` is derived
 * here, not edited by the caller, so refusing the write because the thing had been renamed elsewhere
 * would block a service log for a reason the user cannot act on. ADR-0024's precondition is for
 * writes built from a stale *read of the field being changed*, and this is not one.
 */
export async function logService(
  actor: ActorContext,
  thingId: string,
  input: ThingServiceCreate,
): Promise<ThingService> {
  const thing = await repository.findById(actor, thingId)
  if (thing === undefined) throw new NotFoundError('No such thing.')

  const spaceId = thing.spaceId

  const serviceId = await db.transaction(async (transaction) => {
    const id = await repository.insertService(
      actor,
      spaceId,
      {
        thingId,
        servicedOn: input.serviced_on,
        cost: input.cost ?? null,
        currency: input.currency ?? null,
        provider: input.provider ?? null,
        notes: input.notes ?? null,
      },
      transaction,
    )

    await recomputeServiceDueOn(actor, thingId, thing.serviceEveryMonths, transaction)

    return id
  })

  const created = await repository.findService(actor, thingId, serviceId)
  if (created === undefined) throw new Error('service vanished immediately after creation')
  return toService(created)
}

/**
 * Removes one logged service and re-derives the due date from what is left.
 *
 * ── What happens when the last service is removed ──
 *
 * `service_due_on` is set to **null**, not restored to whatever was seeded at capture. The seed was
 * overwritten the moment the first service was logged, so there is nothing to restore — and a due
 * date derived from a service the user has just deleted is a date the record cannot justify. Null is
 * the honest answer, and re-seeding is one `PATCH`. Stated here because "the due date disappeared"
 * looks like a bug if you have not read this paragraph.
 */
export async function removeService(
  actor: ActorContext,
  thingId: string,
  serviceId: string,
): Promise<void> {
  const thing = await repository.findById(actor, thingId)
  if (thing === undefined) throw new NotFoundError('No such thing.')

  const service = await repository.findService(actor, thingId, serviceId)
  if (service === undefined) throw new NotFoundError('No such service.')

  await db.transaction(async (transaction) => {
    const changed = await repository.softDeleteService(actor, serviceId, transaction)
    if (changed === 0) throw new NotFoundError('No such service.')

    await recomputeServiceDueOn(actor, thingId, thing.serviceEveryMonths, transaction)
  })
}

/**
 * Rule 3's derivation, in the one place it is written.
 *
 * Reads the newest **remaining** service inside the caller's transaction, so the row just inserted
 * or just soft-deleted is accounted for. `listServices` orders newest first with an id tie-break, so
 * `[0]` is deterministic even for two services logged on the same day.
 */
async function recomputeServiceDueOn(
  actor: ActorContext,
  thingId: string,
  serviceEveryMonths: number | null,
  transaction: repository.Executor,
): Promise<void> {
  // No cycle means no due date — rule 3. Leave whatever is there alone rather than inventing one.
  if (serviceEveryMonths === null) return

  const remaining = await repository.listServices(actor, thingId, transaction)
  const newest = remaining[0]
  const nextDue =
    newest === undefined ? null : addMonthsClamped(newest.servicedOn, serviceEveryMonths)

  await repository.updateDerived(actor, thingId, { serviceDueOn: nextDue }, transaction)
}

// ── Photos ───────────────────────────────────────────────────────────────────
//
// The upload lifecycle lives in `things.photos.service.ts`, split out for the same reason
// `documents.files.service.ts` is: presign → PUT → confirm is a distinct state machine with its own
// failure modes, and folding it in here would bury the metadata rules that are this domain's subject.
