import type {
  ConfirmPhotoUploadRequest,
  PresignPhotoDownloadResponse,
  PresignPhotoUploadRequest,
  PresignPhotoUploadResponse,
  ThingPhoto,
} from '@life-manager/shared'
import type { ActorContext } from '../../auth/actor.js'
import { db } from '../../db/client.js'
import { ConflictError, NotFoundError } from '../../lib/errors.js'
import { presignDownload, presignUpload, thingPhotoKeyFor } from '../../lib/storage.js'
import type { ThingPhotoRow } from './things.repository.js'
import * as repository from './things.repository.js'

/**
 * Photo handling for Things. domains/things.md §3 (`thing_photos`), §4 rule 11 and §5's photo verbs.
 *
 * Split out of `things.service.ts` for the same reason `documents.files.service.ts` is split out of
 * `documents.service.ts`: presign → PUT → confirm is a distinct state machine with its own failure
 * modes, and folding it in would bury the metadata rules that are the domain's actual subject.
 *
 * **Bytes never pass through here** (ADR-0008, conventions/api.md §9). This module hands out URLs and
 * records rows; the client talks to R2 directly.
 *
 * ── What is deliberately absent, compared with document files ──
 *
 * No `version` and no monotonic numbering. A photo of a boiler is not a new scan of a document, so
 * versioning it would model a history nobody has (things.md §3). `is_hero` picks the one photo shown
 * at the top of the detail screen and as the list thumbnail; that is the whole ordering story.
 */

/**
 * Its own mapper, duplicated from `things.service.ts`'s — exactly as `documents.files.service.ts`
 * duplicates `toFile`. Importing across two services would make either file's response shape
 * changeable from the other, and the mapper is nine trivial lines.
 */
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
  }
}

/**
 * Confirms the thing exists **and is in one of the actor's spaces**, returning its space id.
 *
 * Every photo operation starts here. A missing or cross-space thing is a 404 either way (business
 * rule 10, invariant 4), so a client cannot use the photo endpoints to probe for things in another
 * space — which would otherwise be a way around the whole tenant filter.
 */
async function requireThingSpace(actor: ActorContext, thingId: string): Promise<string> {
  const thing = await repository.findById(actor, thingId)
  if (thing === undefined) throw new NotFoundError('No such thing.')
  return thing.spaceId
}

/**
 * Step 1 of ADR-0008's transfer sequence: mint a PUT URL for one object.
 *
 * The row is inserted **before** the bytes exist, with `uploaded_at` null. That ordering is what
 * makes the flow recoverable: `photo_id` is issued by us, so `::confirm` needs nothing but that id,
 * and an abandoned upload leaves a row a sweep can find rather than an untracked object in the bucket.
 *
 * Business rule 11 (25 MB, and the image half of the document allowlist — enforced by
 * `presignPhotoUploadRequestSchema` *and* signed into the URL, see `lib/storage.ts`) and invariant 6
 * (the API chooses the key).
 *
 * ── `make_hero` is honoured HERE, not at confirm, and the schema is why ──
 *
 * `presignPhotoUploadRequestSchema` puts `make_hero` on the *presign* request (defaulting to true),
 * where `document_files` decides primacy at confirm time. That is the contract the client already
 * codes against, so the flag is written now, on a row that has no bytes yet — which is exactly why
 * `thing_photos_one_hero_key` also requires `uploaded_at is not null`. An unconfirmed row carries the
 * flag as an *intention*; only a confirmed one can hold the slot. See the index's own comment.
 */
export async function presignPhotoUploadFor(
  actor: ActorContext,
  thingId: string,
  input: PresignPhotoUploadRequest,
): Promise<PresignPhotoUploadResponse> {
  const spaceId = await requireThingSpace(actor, thingId)

  const { photoId, storageKey } = await db.transaction(async (tx) => {
    // The key needs the photo id and the id comes from the insert, so the row is inserted with a
    // placeholder key and updated immediately. Generating the uuid in application code instead would
    // make this the one table whose ids do not come from `gen_random_uuid()`. Both statements are in
    // one transaction, so no row is ever visible with the placeholder.
    const id = await repository.insertPhoto(
      actor,
      spaceId,
      {
        thingId,
        storageKey: '',
        mime: input.mime,
        sizeBytes: input.size_bytes,
        isHero: input.make_hero,
      },
      tx,
    )

    const key = thingPhotoKeyFor({ spaceId, thingId, photoId: id })
    await repository.setPhotoStorageKey(actor, id, key, tx)

    return { photoId: id, storageKey: key }
  })

  const presigned = await presignUpload({
    key: storageKey,
    mime: input.mime,
    sizeBytes: input.size_bytes,
  })

  return {
    photo_id: photoId,
    upload_url: presigned.url,
    storage_key: storageKey,
    expires_at: presigned.expiresAt.toISOString(),
  }
}

/**
 * Step 4: the client reports that the bytes are in place.
 *
 * If the row was presigned with `make_hero`, its siblings are demoted **in the same transaction** —
 * `thing_photos_one_hero_key` is a partial unique index, so doing it in two transactions would either
 * fail or leave a window with no hero.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  DEMOTE FIRST, CONFIRM SECOND. Getting this backwards is a 500, and it was one.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The first version of this function confirmed the row and *then* demoted the old hero, on the
 * plausible-sounding reasoning that the incoming row must be confirmed before it can hold the slot. A
 * non-deferrable unique index is checked **per statement**, not at commit, so the confirming `UPDATE`
 * created a second confirmed hero and Postgres rejected it. Symptom: adding a second photo to any
 * thing returned a 500. Four tests in `things.photos.test.ts` caught it — see `demoteHeroesExcept`.
 *
 * `409` on a photo already confirmed, exactly as a document file's confirm does. Not
 * idempotent-by-silence on purpose: a second confirm means the client lost track of state, and
 * `Idempotency-Key` is the mechanism for a *retried* confirm (conventions/api.md §5) — which replays
 * the first response rather than reaching here.
 */
export async function confirmPhotoUpload(
  actor: ActorContext,
  thingId: string,
  input: ConfirmPhotoUploadRequest,
): Promise<ThingPhoto> {
  await requireThingSpace(actor, thingId)

  const photo = await repository.findPhoto(actor, thingId, input.photo_id)
  if (photo === undefined) throw new NotFoundError('No such photo.')
  if (photo.uploadedAt !== null) throw new ConflictError('That photo has already been confirmed.')

  await db.transaction(async (tx) => {
    /**
     * The intention recorded at presign time. Cleared from every sibling *before* the confirm below,
     * so the index never sees two confirmed heroes — and `is_hero` is already `true` on this row, so
     * there is nothing to promote afterwards.
     */
    if (photo.isHero) {
      await repository.demoteHeroesExcept(actor, thingId, input.photo_id, tx)
    }

    const changed = await repository.confirmPhoto(
      actor,
      input.photo_id,
      { sha256: input.sha256 ?? null },
      tx,
    )
    if (changed === 0) throw new NotFoundError('No such photo.')
  })

  const confirmed = await repository.findPhoto(actor, thingId, input.photo_id)
  if (confirmed === undefined) throw new NotFoundError('No such photo.')
  return toPhoto(confirmed)
}

/** Mirror image of the upload presign — a GET URL for one object (ADR-0008). */
export async function presignPhotoDownloadFor(
  actor: ActorContext,
  thingId: string,
  photoId: string,
): Promise<PresignPhotoDownloadResponse> {
  await requireThingSpace(actor, thingId)

  const photo = await repository.findPhoto(actor, thingId, photoId)
  if (photo === undefined) throw new NotFoundError('No such photo.')

  // An unconfirmed row has no bytes behind it. Presigning anyway would hand the client a URL that
  // 404s at R2, which looks like a storage fault rather than a state error.
  if (photo.uploadedAt === null) {
    throw new ConflictError('That upload was never confirmed, so there is nothing to download.')
  }

  const presigned = await presignDownload({ key: photo.storageKey, mime: photo.mime })

  return {
    download_url: presigned.url,
    expires_at: presigned.expiresAt.toISOString(),
  }
}

/**
 * `PATCH /things/:id/photos/:photoId` — promotion to hero, and **promotion only**.
 *
 * `thingPhotoUpdateSchema` is `{ is_hero: z.literal(true) }`: you demote a photo by promoting
 * another one. A thing with photos and no hero would render with an empty thumbnail slot, which is a
 * worse state than "the wrong one is the main photo".
 */
export async function makeHero(
  actor: ActorContext,
  thingId: string,
  photoId: string,
): Promise<ThingPhoto> {
  await requireThingSpace(actor, thingId)

  const photo = await repository.findPhoto(actor, thingId, photoId)
  if (photo === undefined) throw new NotFoundError('No such photo.')
  if (photo.uploadedAt === null) {
    throw new ConflictError('An unconfirmed photo cannot be made the main one.')
  }

  await db.transaction(async (tx) => {
    // Demote first, promote second — see the note on `confirmPhotoUpload`. Two confirmed heroes for
    // the length of one statement is enough for the unique index to reject the promotion.
    await repository.demoteHeroesExcept(actor, thingId, photoId, tx)
    await repository.setHero(actor, photoId, tx)
  })

  const updated = await repository.findPhoto(actor, thingId, photoId)
  if (updated === undefined) throw new NotFoundError('No such photo.')
  return toPhoto(updated)
}

/**
 * Soft-deletes one photo.
 *
 * **The stored object is deliberately left in place** (conventions/data.md §3, ADR-0008): object
 * cleanup is a separate job so an accidental delete stays recoverable. If the deleted photo was the
 * hero, the newest remaining confirmed photo is promoted — a thing with photos and no hero renders as
 * having none at all, which is worse than picking the obvious successor.
 */
export async function removePhoto(
  actor: ActorContext,
  thingId: string,
  photoId: string,
): Promise<void> {
  await requireThingSpace(actor, thingId)

  const photo = await repository.findPhoto(actor, thingId, photoId)
  if (photo === undefined) throw new NotFoundError('No such photo.')

  await db.transaction(async (tx) => {
    const changed = await repository.softDeletePhoto(actor, photoId, tx)
    if (changed === 0) throw new NotFoundError('No such photo.')

    if (!photo.isHero) return

    // `listPhotos` is oldest-first, so the newest surviving confirmed photo is the last element.
    const remaining = (await repository.listPhotos(actor, thingId, tx)).filter(
      (candidate) => candidate.id !== photoId && candidate.uploadedAt !== null,
    )
    const successor = remaining[remaining.length - 1]
    if (successor === undefined) return
    // The deleted row's flag was cleared by `softDeletePhoto`, but an unconfirmed sibling may still be
    // carrying a presign-time intention — so clear everything else before promoting, keeping "exactly
    // one flagged row" true after this too.
    await repository.demoteHeroesExcept(actor, thingId, successor.id, tx)
    await repository.setHero(actor, successor.id, tx)
  })
}

export async function listPhotos(actor: ActorContext, thingId: string): Promise<ThingPhoto[]> {
  await requireThingSpace(actor, thingId)
  const rows = await repository.listPhotos(actor, thingId)
  return rows.map(toPhoto)
}
