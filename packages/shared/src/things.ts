import { z } from 'zod'
import {
  currencySchema,
  decimalStringSchema,
  isoDateSchema,
  isoDateTimeSchema,
  pageQueryShape,
  sortOrderSchema,
  uuidSchema,
} from './common.js'
import { holderSchema, relationSchema, reminderSchema, versionSchema } from './documents.js'

/**
 * The Things contract. ADR-0029, and the spec it implements is domains/things.md — read §3
 * (entities) and §4 (business rules) before changing anything here.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  THIS CONTRACT EXISTS BEFORE ITS API DOES, AND THAT IS THE POINT.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * There are no `things` tables, no repository, no service and no routes — see things.md §10. The web
 * client already codes against these schemas, so a session building the server half implements
 * *this* rather than inventing a second shape. That is invariant 9 doing the job it exists for: the
 * alternative is two definitions of a thing that agree until they don't.
 *
 * Three project decisions are baked in and are not stylistic:
 *
 * - **`name` is the only field required at capture** — Q2 applied to a second domain
 *   (product/open-questions.md §2, business rule 1). A thing may exist with no kind detail, no
 *   price, no cover and no photo, and every consumer has to render that gracefully.
 * - **Cover is not expiry.** `warranty_ends_on` is a *span's end*, not a validity cliff, and the
 *   words and shapes that render it are deliberately different (ADR-0029, design.md §2a). Nothing in
 *   this file may reuse `expiryOf` or the expiry ladder's vocabulary.
 * - **Query schemas are `z.strictObject`.** conventions/api.md §7 requires unknown query parameters
 *   to be rejected; a plain `z.object` strips them and answers 200. Debt D27.
 *
 * `holder`, `relation`, `reminderSchema` and `versionSchema` are imported from `documents.ts` rather
 * than redefined. A holder means exactly the same thing on both domains — a label, never a
 * permission (documents.md §4 rule 13) — and two definitions of it would be two places for the
 * `?holder=mine` sentinel to drift.
 */

// ── Taxonomy ─────────────────────────────────────────────────────────────────

/**
 * domains/things.md §3. Ten kinds, and the tenth is a deliberate escape hatch.
 *
 * `other` is present so nothing is unfileable, and **absent from the capture chips** so it is never
 * *chosen* — exactly the shape `doc_type: 'other'` has. A user who picks nothing gets `other`; a user
 * who wants "other" has to have been given it by an import.
 *
 * `av` is "TV & audio". Spelled short because it is a column value, not a label — `KIND_LABELS` is
 * where the words live.
 */
export const thingKindSchema = z.enum([
  'phone',
  'laptop',
  'tablet',
  'vehicle',
  'appliance',
  'av',
  'furniture',
  'tool',
  'valuable',
  'other',
])
export type ThingKind = z.infer<typeof thingKindSchema>

/**
 * The words for each kind, and the kinds the capture form offers — in **rough frequency of
 * ownership, not alphabetical**, so the common case is near the start of the row. Same reasoning as
 * `PRESETS` in the documents form.
 *
 * `other` is missing from `CAPTURE_KINDS` on purpose. See `thingKindSchema`.
 */
export const KIND_LABELS: Record<ThingKind, string> = {
  phone: 'Phone',
  laptop: 'Laptop',
  tablet: 'Tablet',
  vehicle: 'Vehicle',
  appliance: 'Appliance',
  av: 'TV & audio',
  furniture: 'Furniture',
  tool: 'Tool',
  valuable: 'Valuables',
  other: 'Thing',
}

export const CAPTURE_KINDS: readonly ThingKind[] = [
  'phone',
  'laptop',
  'tablet',
  'vehicle',
  'appliance',
  'av',
  'furniture',
  'tool',
  'valuable',
]

/**
 * What the serial is *called*, per kind — business rule 8.
 *
 * The label is **always visible** beside the value, because an unlabelled twelve-character string is
 * a string nobody can identify. This is the same argument ADR-0027 makes for a document's number
 * label, and it is why one column can hold an IMEI, a registration and a hallmark without ambiguity.
 */
export const SERIAL_LABELS: Record<ThingKind, string> = {
  phone: 'IMEI',
  laptop: 'Serial number',
  tablet: 'Serial number',
  vehicle: 'Registration',
  appliance: 'Serial number',
  av: 'Serial number',
  furniture: 'Order number',
  tool: 'Serial number',
  valuable: 'Hallmark',
  other: 'Serial number',
}

/**
 * Ownership — business rule 4. **A state, never a delete.**
 *
 *  - `here`  — yours, and in the house.
 *  - `lent`  — yours, and elsewhere. Reminders carry on; counts toward the sum insured.
 *  - `gone`  — sold or given away. The record **stays**, because proving what you handed over and
 *              when is a large part of why anyone files a receipt. Excluded from the sum insured and
 *              from the Now horizon; dimmed in the list rather than hidden.
 *
 * A fourth state for "lost" or "stolen" is the obvious next request and is deliberately absent: it
 * would be `gone` plus a reason, and the reason belongs in `notes` until someone can say what the app
 * would *do* differently with it.
 */
export const ownershipSchema = z.enum(['here', 'lent', 'gone'])
export type Ownership = z.infer<typeof ownershipSchema>

export const MAX_NAME_LENGTH = 200

/**
 * A serial, registration, IMEI or hallmark. **Stored in full, plaintext** — business rule 7, the same
 * decision as `documents.identifier` (ADR-0026).
 *
 * Plaintext by explicit decision: invariant 7 and ADR-0009 reserve application-level encryption for
 * the vault, and this is not the vault. So **no copy in the app may say this is encrypted** (the same
 * trap as debt D44), and `serial` belongs in pino's `REDACTED_PATHS` beside `identifier`.
 *
 * 64 rather than documents' 64-and-also-64: a 17-character VIN and a 15-digit IMEI both fit several
 * times over, and a longer bound is a longer thing to accidentally log.
 */
export const serialInputSchema = z.string().min(1).max(64)

/** The masked display form, DERIVED from `serial` server-side: at most 4 characters. */
export const serialLast4Schema = z.string().max(4)

/**
 * The mask, as the one function that produces it.
 *
 * Deliberately identical to `truncateToLast4` in `documents.ts` and deliberately **not** imported
 * from it: these mask two different columns on two different tables, and a shared helper would make a
 * change to one silently a change to the other. The duplication is four characters of logic; the
 * coupling would be a cross-domain dependency for nothing.
 */
export function truncateSerialToLast4(value: string): string {
  return value.slice(-4)
}

// ── Cover ────────────────────────────────────────────────────────────────────

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  COVER IS NOT EXPIRY. ADR-0029, design.md §2a, things.md §4 rule 2.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * A document that expires is *invalid*. A thing whose cover has **ended keeps working** — so the
 * states, the words and the shapes are all different, and this constant is the boundary.
 *
 * **60 days, where `NEEDS_YOU_DAYS` is 45.** Two thresholds, deliberately: the useful action on an
 * ending warranty — register it, claim on it, decide whether to extend — has a longer lead than
 * renewing a passport. It looks like drift and is not; things.md §4 rule 2 has the reasoning.
 *
 * Like `NEEDS_YOU_DAYS`, this decides **a glyph and a sentence and nothing else**. What actually
 * fires a notification is `reminders.lead_days`, server-side (invariant 5).
 */
export const COVER_ENDING_DAYS = 60

/**
 * Service urgency, and it is **45 rather than cover's 60** — things.md §4 rule 3.
 *
 * A service is an appointment you have to make, which is the same shape of errand as renewing a
 * document, so it borrows the document threshold rather than cover's.
 */
export const SERVICE_DUE_DAYS = 45

/** Cover lengths the capture form offers, in months. `0` is "No cover" — an answer, not a skip. */
export const COVER_LENGTHS: readonly { label: string; months: number }[] = [
  { label: '1 year', months: 12 },
  { label: '2 years', months: 24 },
  { label: '3 years', months: 36 },
  { label: '5 years', months: 60 },
  { label: 'No cover', months: 0 },
]

// ── The entity ───────────────────────────────────────────────────────────────

/** A logged service — things.md §3 `thing_services`. */
export const thingServiceSchema = z.object({
  id: uuidSchema,
  thing_id: uuidSchema,
  serviced_on: isoDateSchema,
  /** A decimal string plus a currency, never a JSON number. conventions/data.md §4. */
  cost: decimalStringSchema.nullable(),
  currency: currencySchema.nullable(),
  /** "VW Kilburn", "Plumbcraft". Free text — it is a memory aid, not a supplier record. */
  provider: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: isoDateTimeSchema,
})
export type ThingService = z.infer<typeof thingServiceSchema>

/**
 * A photo of a thing. **Not a `document_file`** — things.md §3.
 *
 * No `version` and no primary-demotion transaction: a photo of a boiler is not a new scan of a
 * document, so versioning it would model a history nobody has. `is_hero` picks the one shown at the
 * top of the detail screen and as the list thumbnail.
 */
export const thingPhotoSchema = z.object({
  id: uuidSchema,
  thing_id: uuidSchema,
  mime: z.string(),
  size_bytes: z.number().int().min(0),
  sha256: z.string().nullable(),
  is_hero: z.boolean(),
  uploaded_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
  /**
   * Deliberately absent: `storage_key`. The API chooses it (invariant 6, ADR-0008) and a client has
   * no use for it — it talks to R2 through presigned URLs only.
   */
})
export type ThingPhoto = z.infer<typeof thingPhotoSchema>

/**
 * The photo MIME allowlist — business rule 11. **The image half of the document allowlist, minus
 * PDF**: a photo of a boiler is not a PDF, and accepting one here would put a document in a slot
 * whose UI is a thumbnail strip.
 */
export const ALLOWED_PHOTO_MIMES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'image/tiff',
] as const
export const photoMimeSchema = z.enum(ALLOWED_PHOTO_MIMES)
export type PhotoMime = z.infer<typeof photoMimeSchema>

export const thingSchema = z.object({
  id: uuidSchema,
  space_id: uuidSchema,
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  kind: thingKindSchema,
  /** The make. Free text with suggestions, never a foreign key — things.md §9(1). */
  brand: z.string().nullable(),
  model: z.string().nullable(),
  /**
   * The **full** serial, on every response including the list — the same call ADR-0027 made for a
   * document's identifier, for the same reason: the list is where a person stands when they need the
   * number, and a detail round-trip on a cold-starting API is seconds at a counter.
   *
   * The cost is the same one too, and it is real: the persisted Query cache writes list responses to
   * IndexedDB, so a phone that has opened Things holds every serial in plaintext. Debt **D47** now
   * covers both domains.
   */
  serial: z.string().nullable(),
  /** The masked display form, DERIVED from `serial` server-side. Never sent by a client. */
  serial_last4: serialLast4Schema.nullable(),
  purchased_on: isoDateSchema.nullable(),
  price: decimalStringSchema.nullable(),
  currency: currencySchema.nullable(),
  /**
   * The end of cover. **`null` means no warranty recorded, which is a normal state and not a gap** —
   * drawn as absence, in the same grey as a document with no expiry.
   */
  warranty_ends_on: isoDateSchema.nullable(),
  /** The cycle length. `null` means this thing has no service cycle at all. */
  service_every_months: z.number().int().min(1).max(600).nullable(),
  /** The next service. Derived from the newest logged service plus the interval — rule 3. */
  service_due_on: isoDateSchema.nullable(),
  /** "Driveway", "Kitchen cupboard". A memory aid, not an address. */
  kept_at: z.string().nullable(),
  /** A **label**, never a permission. `null` is "mine" and is drawn as absence — rule 6. */
  holder: z.string().nullable(),
  relation: z.string().nullable(),
  ownership: ownershipSchema,
  ownership_who: z.string().nullable(),
  ownership_since: isoDateSchema.nullable(),
  notes: z.string().nullable(),
  /** Denormalised for the list, so drawing a row's "3 documents" needs no N+1. */
  document_count: z.number().int().min(0),
  photo_count: z.number().int().min(0),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  /** Optimistic-concurrency counter — ADR-0024. A `PATCH` must send back the version it read. */
  version: versionSchema,
})
export type Thing = z.infer<typeof thingSchema>

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * **`name` is the only required field** (business rule 1, Q2). Resist adding a second one: a
 * required field is paid on every capture forever, and the wizard's *Skip for now*
 * (ADR-0030) is what makes that promise visible rather than merely true.
 */
export const thingCreateSchema = z.strictObject({
  name: z.string().trim().min(1, 'A name is required').max(MAX_NAME_LENGTH),
  kind: thingKindSchema.default('other'),
  brand: z.string().trim().max(120).nullish(),
  model: z.string().trim().max(200).nullish(),
  /** Truncated into `serial_last4` server-side — business rule 7. */
  serial: serialInputSchema.nullish(),
  purchased_on: isoDateSchema.nullish(),
  price: decimalStringSchema.nullish(),
  currency: currencySchema.nullish(),
  warranty_ends_on: isoDateSchema.nullish(),
  service_every_months: z.number().int().min(1).max(600).nullish(),
  service_due_on: isoDateSchema.nullish(),
  kept_at: z.string().trim().max(200).nullish(),
  holder: holderSchema.nullish(),
  relation: relationSchema.nullish(),
  notes: z.string().max(10_000).nullish(),
  /**
   * Deliberately absent: `ownership`, `ownership_who`, `ownership_since`. A thing is created `here`
   * — you cannot file something you have already given away, and offering the field at capture would
   * put a three-way choice on the fast path for a state most things never reach. It moves through
   * `PATCH`, from the detail screen's *"It's not with me any more"*.
   */
})
export type ThingCreate = z.infer<typeof thingCreateSchema>

// ── Update ───────────────────────────────────────────────────────────────────

/**
 * `PATCH` semantics per conventions/api.md §8: **an absent key means "don't change"**, and an
 * explicit `null` means "clear this field". Those are genuinely different, which is why every
 * nullable field is `.nullish()` on an all-optional object rather than `.partial()` of the create
 * schema.
 *
 * ── The ownership triple moves together, and the schema says so ──
 *
 * `ownership_who` and `ownership_since` cannot outlive `ownership` (business rule 4), so a patch
 * setting `ownership: 'here'` must clear both. That is enforced in the *service* rather than here,
 * because a refine could only reject the bad combination and the useful behaviour is to fix it — the
 * same shape as `holderColumns()` writing `holder` and `relation` in one statement.
 */
export const thingUpdateSchema = z
  .strictObject({
    /**
     * **Required, deliberately** — ADR-0024. The version the client last read; the server refuses
     * the write with `409` if the record has moved on. Optional would mean a call site that forgot
     * it silently gets last-write-wins.
     */
    version: versionSchema,
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
    kind: thingKindSchema.optional(),
    brand: z.string().trim().max(120).nullish(),
    model: z.string().trim().max(200).nullish(),
    serial: serialInputSchema.nullish(),
    purchased_on: isoDateSchema.nullish(),
    price: decimalStringSchema.nullish(),
    currency: currencySchema.nullish(),
    warranty_ends_on: isoDateSchema.nullish(),
    service_every_months: z.number().int().min(1).max(600).nullish(),
    service_due_on: isoDateSchema.nullish(),
    kept_at: z.string().trim().max(200).nullish(),
    holder: holderSchema.nullish(),
    relation: relationSchema.nullish(),
    ownership: ownershipSchema.optional(),
    ownership_who: z.string().trim().max(120).nullish(),
    ownership_since: isoDateSchema.nullish(),
    notes: z.string().max(10_000).nullish(),
  })
  // `version` is a precondition, not a change, so `{ version: 3 }` alone is not an update.
  .refine((patch) => Object.keys(patch).some((key) => key !== 'version'), {
    message: 'A patch must change at least one field',
  })
export type ThingUpdate = z.infer<typeof thingUpdateSchema>

/** `POST /api/v1/things/:id/services` — log one. Recomputes `service_due_on` (rule 3). */
export const thingServiceCreateSchema = z.strictObject({
  serviced_on: isoDateSchema,
  cost: decimalStringSchema.nullish(),
  currency: currencySchema.nullish(),
  provider: z.string().trim().max(200).nullish(),
  notes: z.string().max(2000).nullish(),
})
export type ThingServiceCreate = z.infer<typeof thingServiceCreateSchema>

// ── List query ───────────────────────────────────────────────────────────────

/**
 * **`name`, not a date.** A document sorts by `expires_on` because "what needs doing" is the question
 * that domain answers; a thing has no single date that orders it the same way — cover, service and
 * purchase all compete — so it sorts alphabetically, which is the one order a person can predict.
 * things.md §5.
 */
export const thingSortSchema = z.enum(['name', 'purchased_on', 'warranty_ends_on', 'service_due_on'])
export type ThingSort = z.infer<typeof thingSortSchema>

/** A repeatable query parameter arrives as a string for one value and an array for several. */
const repeatable = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item)]).transform((value) => (Array.isArray(value) ? value : [value]))

/**
 * `GET /api/v1/things`. things.md §5.
 *
 * **`z.strictObject`, and that is the whole point of debt D27** — `?kin=vehicle` must be a 400, not a
 * silent full-table read.
 */
export const thingListQuerySchema = z.strictObject({
  ...pageQueryShape,
  q: z.string().trim().min(1).max(200).optional(),
  kind: repeatable(thingKindSchema).optional(),
  /**
   * An exact holder name, or the literal `mine` (`HOLDER_MINE` from `documents.ts`) for
   * `holder IS NULL`. Same three states and the same sentinel as the documents filter — read the note
   * on `documentListQuerySchema.holder` rather than trusting a paraphrase.
   */
  holder: z.string().trim().min(1).max(120).optional(),
  /**
   * Repeatable, unlike `holder`. "Whose" is one answer at a time; ownership is a set — "show me what
   * is here or lent" is a real question and `?ownership=here&ownership=lent` is how it is asked.
   */
  ownership: repeatable(ownershipSchema).optional(),
  sort: thingSortSchema.default('name'),
  order: sortOrderSchema.default('asc'),
})
export type ThingListQuery = z.infer<typeof thingListQuerySchema>

// ── Responses ────────────────────────────────────────────────────────────────

export const thingListResponseSchema = z.object({
  data: z.array(thingSchema),
  next_cursor: z.string().nullable(),
})
export type ThingListResponse = z.infer<typeof thingListResponseSchema>

/**
 * `GET /api/v1/things/:id`.
 *
 * ── `documents` is a SUMMARY, not the document schema ──
 *
 * Nesting `documentSchema` here would put every linked document's full `identifier` on a Things
 * response, which is a second route to the same plaintext for no gain: the thing screen draws a title,
 * a status and an issuer, and tapping a row navigates to the document itself. So this carries only
 * what the row renders. ADR-0027's argument for the full number on a *document* list does not
 * transfer — nobody stands at a counter reading a number off a thing's detail screen.
 */
export const linkedDocumentSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  doc_type: z.string(),
  issuer: z.string().nullable(),
  expires_on: isoDateSchema.nullable(),
})
export type LinkedDocument = z.infer<typeof linkedDocumentSchema>

export const thingDetailResponseSchema = thingSchema.extend({
  photos: z.array(thingPhotoSchema),
  /** Newest first — the log reads as history, and the newest row is what drives `service_due_on`. */
  services: z.array(thingServiceSchema),
  documents: z.array(linkedDocumentSchema),
  reminders: z.array(reminderSchema),
})
export type ThingDetailResponse = z.infer<typeof thingDetailResponseSchema>

/** `GET /api/v1/things/holders` — pairs, not names, so picking a person fills the relation too. */
export const thingHoldersResponseSchema = z.object({
  data: z.array(z.object({ holder: z.string(), relation: z.string().nullable() })),
})
export type ThingHoldersResponse = z.infer<typeof thingHoldersResponseSchema>

// ── Photo endpoints ──────────────────────────────────────────────────────────

/**
 * `POST /things/:id/photos::presign-upload`.
 *
 * **No storage key, path, or destination filename** — invariant 6 and ADR-0008. `z.strictObject`
 * gets that for free: there is no key here for one to land in.
 *
 * Note the `::` in the route. A `:verb` needs the double colon and **may only follow a static
 * segment**; the photo is named in the *body* on the download verb for exactly the reason
 * `documents.md` §5 gives — `/photos/:photoId:presign-download` generates a broken OpenAPI path even
 * though Fastify routes it correctly. conventions/api.md §2.
 */
export const presignPhotoUploadRequestSchema = z.strictObject({
  mime: photoMimeSchema,
  /** Checked against the limit **before any bytes move**. Same 25 MB ceiling as a document file. */
  size_bytes: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
  /** The first photo on a thing becomes the hero unless told otherwise. */
  make_hero: z.boolean().default(true),
})
export type PresignPhotoUploadRequest = z.infer<typeof presignPhotoUploadRequestSchema>

export const presignPhotoUploadResponseSchema = z.object({
  photo_id: uuidSchema,
  upload_url: z.string(),
  /** Returned for transparency and debugging, **not** for the client to use or echo back. */
  storage_key: z.string(),
  expires_at: isoDateTimeSchema,
})
export type PresignPhotoUploadResponse = z.infer<typeof presignPhotoUploadResponseSchema>

export const confirmPhotoUploadRequestSchema = z.strictObject({
  photo_id: uuidSchema,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Must be a lowercase hex SHA-256 digest')
    .optional(),
})
export type ConfirmPhotoUploadRequest = z.infer<typeof confirmPhotoUploadRequestSchema>

export const presignPhotoDownloadRequestSchema = z.strictObject({ photo_id: uuidSchema })
export type PresignPhotoDownloadRequest = z.infer<typeof presignPhotoDownloadRequestSchema>

export const presignPhotoDownloadResponseSchema = z.object({
  download_url: z.string(),
  expires_at: isoDateTimeSchema,
})
export type PresignPhotoDownloadResponse = z.infer<typeof presignPhotoDownloadResponseSchema>

/** `PATCH /things/:id/photos/:photoId` — `is_hero` only, and promotion only. */
export const thingPhotoUpdateSchema = z.strictObject({
  is_hero: z.literal(true, {
    message: 'Only promotion to hero is supported; demote by promoting another photo',
  }),
})
export type ThingPhotoUpdate = z.infer<typeof thingPhotoUpdateSchema>

// ── Params ───────────────────────────────────────────────────────────────────

export const thingIdParamsSchema = z.object({ id: uuidSchema })
export const thingPhotoParamsSchema = z.object({ id: uuidSchema, photoId: uuidSchema })
export const thingServiceParamsSchema = z.object({ id: uuidSchema, serviceId: uuidSchema })

/**
 * The version precondition for `DELETE /things/:id` — the same shape as a document's, and for the
 * same reason (debt D41): a delete built against stale data is refused with `409` rather than
 * destroying an edit made somewhere else in the meantime.
 *
 * A query parameter rather than a body, because a `DELETE` with a body is poorly supported and
 * `fetch` will not reliably send one.
 */
export const thingDeleteQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(1),
})
export type ThingDeleteQuery = z.infer<typeof thingDeleteQuerySchema>
