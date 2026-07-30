import { z } from 'zod'
import {
  countryCodeSchema,
  currencySchema,
  decimalStringSchema,
  isoDateSchema,
  isoDateTimeSchema,
  pageQueryShape,
  sortOrderSchema,
  uuidSchema,
} from './common.js'

/**
 * The Documents contract. ADR-0004: these schemas are the ONLY source of the wire shape, and
 * the spec they implement is domains/documents.md — read §3 (entities) and §4 (business
 * rules) before changing anything here.
 *
 * Two project decisions are baked into this file and are not stylistic:
 *
 * - **Q2 (answered 2026-07-28): `title` is the only field required at capture.** Every other
 *   field on `documentCreateSchema` is optional. That is a load-bearing product decision, not
 *   laziness — see product/open-questions.md §2. It also means every consumer must handle a
 *   document whose `doc_type` is `other` and whose every other field is null.
 * - **Query schemas are `z.strictObject`.** conventions/api.md §7 requires unknown query
 *   parameters to be rejected; a plain `z.object` strips them and answers 200. Debt D27.
 */

// ── Taxonomy ─────────────────────────────────────────────────────────────────

/** domains/documents.md §3. `other` is the default, not an error state (Q2). */
export const documentTypeSchema = z.enum([
  'identity',
  'financial',
  'legal',
  'warranty',
  'receipt',
  'certificate',
  'other',
])
export type DocumentType = z.infer<typeof documentTypeSchema>

/**
 * The types that get automatic reminders at the default lead times (business rule 8).
 * Identity documents and certificates are the ones with painful renewal timelines.
 */
export const AUTO_REMINDER_TYPES: readonly DocumentType[] = ['identity', 'certificate']

/** Business rule 8. Days before `expires_on`, longest first. */
export const DEFAULT_LEAD_DAYS: readonly number[] = [90, 30, 7]

export const MAX_TITLE_LENGTH = 200
export const MAX_TAGS = 25

/**
 * A tag, normalised to lowercase **by the contract** rather than by each caller.
 *
 * Not cosmetic: `documents.search_vector` folds tags in via `array_to_tsvector`, which produces
 * lexemes verbatim — no case folding — so a tag stored as `Travel` would be unfindable by a
 * search for `travel`. Normalising here means the database's assumption is guaranteed by the
 * only schema that can write a tag. It also makes `?tag=` case-insensitive for free, which is
 * what anyone typing a tag expects.
 */
export const tagSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .transform((tag) => tag.toLowerCase())

/**
 * The identifier a document carries: a passport number, an Aadhaar number, a policy number.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Rule 6 REVERSED: the full value is now stored. See ADR-0026.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * This used to truncate to four characters at the API boundary, on the argument that the full number
 * is on the scan anyway so a plaintext column was a needless liability. That argument had a hole: **a
 * number you cannot read is a number you go and dig the original out for**, which is the exact
 * errand this app exists to remove. And for the documents its user actually owns — Aadhaar, PAN,
 * a vehicle registration — the number *is* the thing you need at a counter, far more often than the
 * scan is.
 *
 * So the full value is stored, and `identifier_last4` stays as the **display** form: it is what the
 * list and every row show, and what the detail screen shows until you tap Reveal. Two fields, one
 * derived from the other, because masking is a display state and not a storage decision.
 *
 * **It is stored as plaintext, by explicit decision.** Invariant 7 and ADR-0009 reserve
 * application-level encryption for the vault, and this is not the vault — so nothing here is
 * encrypted, and no copy in the app may claim it is. The fields stay in pino's redaction list, which
 * now matters more rather than less: the value that must not reach a log is a whole number instead of
 * four digits.
 */
export const identifierInputSchema = z.string().min(1).max(64)

/**
 * A holder's name. Trimmed, because the same person typed with a trailing space would autocomplete as
 * two people and filter as neither.
 */
export const holderSchema = z.string().trim().min(1).max(120)

/** A relation — "Wife", "Son (12)". Short by design: it is a gloss on a name, not a biography. */
export const relationSchema = z.string().trim().min(1).max(60)

/** The masked display form, derived from the stored value: at most 4 characters. */
export const identifierLast4Schema = z.string().max(4)

/**
 * The `?holder=` value meaning "the owner's own", i.e. `holder IS NULL`.
 *
 * Exported so the client and the repository cannot disagree about the spelling of it — a mismatch here
 * would be a filter that silently matches nothing.
 */
export const HOLDER_MINE = 'mine'

/**
 * The mask, as the one function that produces it.
 *
 * Still the only way `identifier_last4` is ever computed — the difference since ADR-0026 is that the
 * argument is no longer discarded afterwards.
 */
export function truncateToLast4(value: string): string {
  return value.slice(-4)
}

// ── custom_attrs, per doc_type ───────────────────────────────────────────────

/**
 * domains/documents.md §3. JSONB in the database, but **not freeform over the wire** — a
 * discriminated union on `doc_type` validates it at the API boundary
 * (conventions/data.md §5), so a client cannot write arbitrary keys.
 *
 * `z.strictObject` on every member, deliberately: an unrecognised key in `custom_attrs` is a
 * client bug or a typo'd field name, and silently dropping it would lose data the user
 * thought they had saved.
 *
 * **Every field is optional** — capture friction is the bigger risk (Q2, brain.md principle
 * 2). And **every money field is a decimal string plus a currency**, never a JSON number:
 * see `decimalStringSchema`.
 */
const identityAttrs = z.strictObject({
  document_number_last4: identifierLast4Schema.optional(),
  issuing_authority: z.string().max(200).optional(),
  nationality: countryCodeSchema.optional(),
  place_of_issue: z.string().max(200).optional(),
})

const financialAttrs = z.strictObject({
  counterparty: z.string().max(200).optional(),
  account_last4: identifierLast4Schema.optional(),
  value: decimalStringSchema.optional(),
  currency: currencySchema.optional(),
  renewal_terms: z.string().max(1000).optional(),
})

const legalAttrs = z.strictObject({
  counterparty: z.string().max(200).optional(),
  jurisdiction: z.string().max(200).optional(),
  effective_from: isoDateSchema.optional(),
  renewal_terms: z.string().max(1000).optional(),
})

const warrantyAttrs = z.strictObject({
  vendor: z.string().max(200).optional(),
  product: z.string().max(200).optional(),
  serial_number: z.string().max(120).optional(),
  purchase_price: decimalStringSchema.optional(),
  currency: currencySchema.optional(),
  purchased_on: isoDateSchema.optional(),
  coverage_months: z.number().int().min(0).max(1200).optional(),
})

const receiptAttrs = z.strictObject({
  vendor: z.string().max(200).optional(),
  amount: decimalStringSchema.optional(),
  currency: currencySchema.optional(),
  purchased_on: isoDateSchema.optional(),
  payment_method_last4: identifierLast4Schema.optional(),
})

const certificateAttrs = z.strictObject({
  issuing_body: z.string().max(200).optional(),
  credential_id: z.string().max(120).optional(),
  level: z.string().max(120).optional(),
  verify_url: z.url().max(2000).optional(),
})

/** `other` carries no structured attributes — freeform `notes` only (§3). */
const otherAttrs = z.strictObject({})

/**
 * Keyed by `doc_type`. Exported so the service can validate `custom_attrs` **after** resolving
 * which type a PATCH leaves the document in — a discriminated union cannot do that on its own,
 * because a PATCH may change `doc_type` and `custom_attrs` in either order or one without the
 * other.
 */
export const CUSTOM_ATTRS_BY_TYPE = {
  identity: identityAttrs,
  financial: financialAttrs,
  legal: legalAttrs,
  warranty: warrantyAttrs,
  receipt: receiptAttrs,
  certificate: certificateAttrs,
  other: otherAttrs,
} as const satisfies Record<DocumentType, z.ZodType>

/**
 * The permissive wire type for `custom_attrs`. The **real** validation is
 * `CUSTOM_ATTRS_BY_TYPE[docType]`, applied in the service once the effective `doc_type` is
 * known — see `validateCustomAttrs()`.
 *
 * This is not a loophole: the service rejects anything the per-type schema does not accept,
 * and a route cannot skip that step because `custom_attrs` reaches the repository only through
 * the service. Kept loose here purely so a PATCH that changes `doc_type` and `custom_attrs`
 * together is validated against the *new* type rather than the old one.
 */
export const customAttrsWireSchema = z.record(z.string(), z.unknown())
export type CustomAttrs = Record<string, unknown>

/**
 * Validates `custom_attrs` against the effective `doc_type`. Returns the parsed value or a
 * list of problems — never throws, so the service decides the error type
 * (conventions/code.md §6: services throw domain errors, helpers do not invent them).
 */
export function validateCustomAttrs(
  docType: DocumentType,
  attrs: CustomAttrs,
): { ok: true; value: CustomAttrs } | { ok: false; issues: { path: string; message: string }[] } {
  const result = CUSTOM_ATTRS_BY_TYPE[docType].safeParse(attrs)
  if (result.success) return { ok: true, value: result.data as CustomAttrs }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: `custom_attrs.${issue.path.join('.')}`,
      message: issue.message,
    })),
  }
}

// ── The entity ───────────────────────────────────────────────────────────────

/**
 * Server-assigned optimistic-concurrency counter — ADR-0024.
 *
 * Starts at 1, never 0, so a value that failed to arrive cannot pass for a valid one.
 */
export const versionSchema = z.number().int().min(1)

export const documentSchema = z.object({
  id: uuidSchema,
  space_id: uuidSchema,
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  doc_type: documentTypeSchema,
  issuer: z.string().nullable(),
  /**
   * Whose document this is — free text, `null` for the owner's own.
   *
   * **A label, not a permission.** Nobody is invited and nothing is shared; a holder is a word on a
   * document, and `space_id` remains the only thing that decides who can read it (invariant 2 and 3).
   * Sharing, when it arrives, is a space growing a second member — a different mechanism, and this
   * field will not change to accommodate it.
   *
   * `null` means "mine", which is why the account holder has no name anywhere in the app: it is the
   * absence of a holder, drawn as absence, in the same way `other` is the absence of a type.
   */
  holder: z.string().nullable(),
  /** How the holder relates to the owner — "Wife", "Son (12)". Free text and purely cosmetic. */
  relation: z.string().nullable(),
  /**
   * The **full** identifier — on every response that carries a document, including the list.
   *
   * ADR-0026 put this on the detail response only, on data-minimisation grounds. **ADR-0027 moved it
   * here**, because the archive is where a person goes when they need a number and a detail round-trip
   * on a cold-starting API is seconds of standing at a counter.
   *
   * The cost is stated in ADR-0027 and is real: the persisted Query cache writes list responses to
   * IndexedDB, so a phone that has opened the archive holds every number in plaintext. `identifier` is
   * in pino's redaction list; the cache is the remaining exposure (debt D47).
   */
  identifier: z.string().nullable(),
  /** The masked display form, DERIVED from `identifier` server-side. Never sent by a client. */
  identifier_last4: identifierLast4Schema.nullable(),
  /**
   * The **thing** this document belongs to, or `null` — [ADR-0029](../../../docs/decisions/0029-the-things-domain.md).
   *
   * One nullable column rather than a join table: a receipt belongs to one object, and an object
   * collects many papers. `on delete set null`, so deleting a car does **not** shred its paperwork
   * (things.md §4 rule 5) — the copy on that delete control says exactly that, and a cascade here
   * would make it a lie.
   *
   * The relationship is drawn from **both** sides — *Belongs to* on a document, *Its documents* on a
   * thing — but it is written from this one, because this is where the column is.
   *
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  `.nullish().default(null)`, NOT `.nullable()` — and this cost a production outage.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *
   * A plain `.nullable()` makes the **key required**. `lib/api.ts` parses every document response
   * with this schema, so an older server that does not send the key at all fails the parse and throws
   * — taking out the Now screen and the whole archive, not just this one field.
   *
   * That is not hypothetical. Cloudflare Pages deployed the web app on push while the Cloud Build
   * trigger did not deploy the API, so the client required `thing_id` against a server ten commits
   * behind that had never heard of it. Both halves deploy independently
   * ([README.md](../../../README.md) § Deploying), which means **the client is never entitled to
   * assume the server is the same age as it is** — and a required response field is exactly that
   * assumption, written down.
   *
   * `.default(null)` keeps the OUTPUT type `string | null`, so nothing downstream branches on
   * `undefined`; only the input becomes tolerant. Absence and `null` mean the same thing to every
   * consumer here — "not linked to anything" — so collapsing them loses no information.
   *
   * ── When NOT to copy this ──
   *
   * Tolerating a missing field is right for a field the client treats as *optional information*. It
   * is **wrong** for a field the client depends on: there, a loud parse failure is the contract doing
   * its job, and silently defaulting would hide real drift (ADR-0004). The test is whether absence and
   * the default are genuinely indistinguishable to the consumer. Here they are.
   *
   * It also closes the stale-cache half of debt **D46**: the persisted cache rehydrates **without**
   * re-running Zod, so a document cached by an older build arrives missing this key. That is the same
   * failure that crashed the app at its root error boundary when ADR-0026 added `identifier`.
   */
  thing_id: uuidSchema.nullish().default(null),
  issued_on: isoDateSchema.nullable(),
  expires_on: isoDateSchema.nullable(),
  country: countryCodeSchema.nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  custom_attrs: customAttrsWireSchema,
  /** Denormalised for the list view, so rendering a list needs no N+1 (`has_file` filter). */
  file_count: z.number().int().min(0),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  /**
   * Optimistic-concurrency counter — [ADR-0024](../../../docs/decisions/0024-offline-writes-outbox.md).
   *
   * Server-assigned and incremented on every update. A client must send back the version it read
   * when it updates; the server refuses a stale write with `409` rather than applying it. This is
   * what makes an offline edit safe to replay on reconnect.
   */
  version: versionSchema,
})
export type Document = z.infer<typeof documentSchema>

// ── Files ────────────────────────────────────────────────────────────────────

/** Business rule 11. Kept here rather than in the API so the client can pre-check for UX. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

/** Business rule 11. An allowlist, never a denylist. */
export const ALLOWED_UPLOAD_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'image/tiff',
] as const

export const uploadMimeSchema = z.enum(ALLOWED_UPLOAD_MIMES)
export type UploadMime = z.infer<typeof uploadMimeSchema>

export const documentFileSchema = z.object({
  id: uuidSchema,
  document_id: uuidSchema,
  version: z.number().int().min(1),
  mime: z.string(),
  size_bytes: z.number().int().min(0),
  sha256: z.string(),
  is_primary: z.boolean(),
  uploaded_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
  /**
   * Deliberately absent: `storage_key`. The API chooses it (invariant 6,
   * ADR-0008) and a client has no use for it — it talks to R2 through presigned URLs only.
   * Exposing it would invite a client to construct one.
   */
})
export type DocumentFile = z.infer<typeof documentFileSchema>

// ── Reminder, as nested in a document detail response ────────────────────────

export const reminderChannelSchema = z.enum(['web_push', 'email', 'fcm', 'apns'])
export type ReminderChannel = z.infer<typeof reminderChannelSchema>

export const reminderSchema = z.object({
  id: uuidSchema,
  entity_type: z.literal('document'),
  entity_id: uuidSchema,
  due_on: isoDateSchema,
  lead_days: z.number().int().min(0).max(3650),
  channel: reminderChannelSchema,
  sent_at: isoDateTimeSchema.nullable(),
  dismissed_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
})
export type Reminder = z.infer<typeof reminderSchema>

// ── Create ───────────────────────────────────────────────────────────────────

/**
 * **`title` is the only required field** (Q2, business rule 1). Resist adding a second one:
 * a required field is paid on every capture forever, and the answer to Q2 was explicit that
 * capture friction is the bigger risk than incomplete records.
 */
export const documentCreateSchema = z.strictObject({
  title: z.string().trim().min(1, 'A title is required').max(MAX_TITLE_LENGTH),
  doc_type: documentTypeSchema.default('other'),
  issuer: z.string().trim().max(200).nullish(),
  /** Truncated to the last 4 characters server-side — business rule 6. */
  identifier: identifierInputSchema.nullish(),
  holder: holderSchema.nullish(),
  relation: relationSchema.nullish(),
  /**
   * Settable at capture, because that is where it is most often known: the vehicle papers checklist
   * opens this form already knowing which thing it is filing against (things.md §7).
   */
  thing_id: uuidSchema.nullish(),
  issued_on: isoDateSchema.nullish(),
  expires_on: isoDateSchema.nullish(),
  country: countryCodeSchema.nullish(),
  notes: z.string().max(10_000).nullish(),
  tags: z.array(tagSchema).max(MAX_TAGS).default([]),
  custom_attrs: customAttrsWireSchema.default({}),
})
export type DocumentCreate = z.infer<typeof documentCreateSchema>

// ── Update ───────────────────────────────────────────────────────────────────

/**
 * `PATCH` semantics per conventions/api.md §8: **an absent key means "don't change"**, and an
 * explicit `null` means "clear this field". Those are genuinely different, which is why every
 * nullable field is `.nullish()` on an all-optional object rather than `.partial()` of the
 * create schema — `.partial()` cannot distinguish the two.
 */
export const documentUpdateSchema = z
  .strictObject({
    /**
     * **Required, deliberately.** The version the client last read; the server refuses the write with
     * `409` if the record has moved on (ADR-0024).
     *
     * Optional would have been the non-breaking choice, and it is the wrong one: a call site that
     * forgot to send it would silently get last-write-wins, which is the exact behaviour ADR-0013
     * called "actively dangerous" and ADR-0024 declined for a second time. Making it required means a
     * forgotten precondition is a type error rather than a data-loss path.
     */
    version: versionSchema,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH).optional(),
    doc_type: documentTypeSchema.optional(),
    issuer: z.string().trim().max(200).nullish(),
    identifier: identifierInputSchema.nullish(),
    holder: holderSchema.nullish(),
    relation: relationSchema.nullish(),
    /** Linking and unlinking are both this field — `null` clears it (conventions/api.md §8). */
    thing_id: uuidSchema.nullish(),
    issued_on: isoDateSchema.nullish(),
    expires_on: isoDateSchema.nullish(),
    country: countryCodeSchema.nullish(),
    notes: z.string().max(10_000).nullish(),
    tags: z.array(tagSchema).max(MAX_TAGS).optional(),
    custom_attrs: customAttrsWireSchema.optional(),
  })
  // `version` is a precondition, not a change, so it does not count towards "changes something".
  // Without excluding it, `{ version: 3 }` alone would be accepted as a no-op update.
  .refine((patch) => Object.keys(patch).some((key) => key !== 'version'), {
    message: 'A patch must change at least one field',
  })
export type DocumentUpdate = z.infer<typeof documentUpdateSchema>

// ── List query ───────────────────────────────────────────────────────────────

export const documentSortSchema = z.enum(['expires_on', 'created_at', 'title'])
export type DocumentSort = z.infer<typeof documentSortSchema>

/**
 * A repeatable query parameter arrives as a string for one value and an array for several.
 * Normalising to an array here means the repository never branches on arity.
 */
const repeatable = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item)]).transform((value) => (Array.isArray(value) ? value : [value]))

/**
 * `GET /api/v1/documents`. domains/documents.md §5.
 *
 * **`z.strictObject`, and that is the whole point of debt D27** — `?expiring_befor=2026-12-31`
 * must be a 400, not a silent full-table read. If you add a filter, add it here; if a client
 * sends something not listed here, it is a typo and it fails loudly.
 *
 * Default sort is `expires_on asc, nulls last` — §5 is explicit that this, not `created_at`,
 * is the useful default: the question this domain answers is "what needs doing about it".
 */
export const documentListQuerySchema = z.strictObject({
  ...pageQueryShape,
  q: z.string().trim().min(1).max(200).optional(),
  type: repeatable(documentTypeSchema).optional(),
  tag: repeatable(tagSchema).optional(),
  expiring_before: isoDateSchema.optional(),
  /**
   * Filter by whose document it is.
   *
   * ── Three states, and the middle one is why this is not just a name ──
   *
   *  - **absent** — no filter, every holder.
   *  - **`mine`** — the owner's own, i.e. `holder IS NULL`. A literal sentinel rather than an empty
   *    string, because `?holder=` is indistinguishable from `?holder` in enough query-string parsers
   *    that relying on it would be a filter that works until the parser changes. The collision risk —
   *    someone actually filing a document under the name "mine" — is accepted and documented here,
   *    because the alternative is a second boolean parameter for one filter.
   *  - **any other string** — an exact holder match.
   *
   * Not `repeatable()`, unlike `type` and `tag`. Those are AND-ed checkboxes; "whose" is one answer at
   * a time, which is what the design's single chip draws.
   */
  holder: z.string().trim().min(1).max(120).optional(),
  /**
   * The documents filed against one thing — ADR-0029.
   *
   * A plain uuid rather than a `mine`-style sentinel for "unlinked": nothing in the UI asks for
   * "documents belonging to no thing", and a filter nobody offers is a filter that rots. If that
   * question ever gets asked, it gets its own spelling and its own note here.
   */
  thing_id: uuidSchema.optional(),
  has_file: z.stringbool().optional(),
  sort: documentSortSchema.default('expires_on'),
  order: sortOrderSchema.default('asc'),
})
export type DocumentListQuery = z.infer<typeof documentListQuerySchema>

// ── Responses ────────────────────────────────────────────────────────────────

/**
 * Written out rather than built with `paginated(documentSchema)` because the OpenAPI document
 * is nicer with a named shape here, and because this list carries no extra fields — if it ever
 * needs a total or a facet count, it gets added here and `paginated()` stays generic.
 */
export const documentListResponseSchema = z.object({
  data: z.array(documentSchema),
  next_cursor: z.string().nullable(),
})
export type DocumentListResponse = z.infer<typeof documentListResponseSchema>

/**
 * `GET /api/v1/documents/holders` — the people picker's suggestions.
 *
 * Pairs, not names: picking a known person fills the relation too, which is what keeps `relation`
 * being stored per document from surfacing as work for the user.
 */
export const holdersResponseSchema = z.object({
  data: z.array(z.object({ holder: z.string(), relation: z.string().nullable() })),
})
export type HoldersResponse = z.infer<typeof holdersResponseSchema>

/** `GET /api/v1/documents/:id` — includes files and reminders (§5). */
export const documentDetailResponseSchema = documentSchema.extend({
  /*
    `identifier` is NOT re-declared here. It moved onto `documentSchema` in ADR-0027, so this response
    inherits it — as does the list. Space scoping is unchanged and is the repository's job: the field
    is only reachable through a query already filtered by `space_id IN actor.spaceIds` (invariant 3),
    so a cross-space read 404s before it can return one (invariant 4).
  */
  files: z.array(documentFileSchema),
  reminders: z.array(reminderSchema),
})
export type DocumentDetailResponse = z.infer<typeof documentDetailResponseSchema>

// ── File endpoints ───────────────────────────────────────────────────────────

/**
 * `POST /documents/:id/files:presign-upload`.
 *
 * **No storage key, path, or destination filename** — invariant 6 and business rule 5. A
 * request carrying one is rejected, which `z.strictObject` does for free: there is no key here
 * for it to land in. `filename` is absent for the same reason; the client's local filename is
 * not the API's business and would be an obvious path-traversal vector.
 */
export const presignUploadRequestSchema = z.strictObject({
  mime: uploadMimeSchema,
  /** Checked against the limit **before any bytes move** — §5 notes the 413 happens here. */
  size_bytes: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  /** Business rule 3: a new version becomes primary unless told otherwise. */
  make_primary: z.boolean().default(true),
})
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>

export const presignUploadResponseSchema = z.object({
  file_id: uuidSchema,
  upload_url: z.string(),
  /**
   * Returned for transparency and debugging, **not** for the client to use or echo back.
   * `:confirm` takes `file_id` alone precisely so the key cannot be influenced.
   */
  storage_key: z.string(),
  version: z.number().int().min(1),
  expires_at: isoDateTimeSchema,
})
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>

/** `POST /documents/:id/files:confirm`. The client reports what it actually uploaded. */
export const confirmUploadRequestSchema = z.strictObject({
  file_id: uuidSchema,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'Must be a lowercase hex SHA-256 digest')
    .optional(),
})
export type ConfirmUploadRequest = z.infer<typeof confirmUploadRequestSchema>

/**
 * `POST /documents/:id/files:presign-download`.
 *
 * The file is named in the **body**, mirroring `:confirm`, rather than in the path. That is not a
 * style preference: a `:verb` suffix immediately after a path parameter
 * (`/files/:fileId:presign-download`) generates a **broken OpenAPI path** —
 * `/files/{fileId}:{presign}-download` — even though Fastify routes it correctly. Measured, not
 * guessed; see the block comment in `documents.routes.ts` and conventions/api.md §2.
 */
export const presignDownloadRequestSchema = z.strictObject({
  file_id: uuidSchema,
})
export type PresignDownloadRequest = z.infer<typeof presignDownloadRequestSchema>

export const presignDownloadResponseSchema = z.object({
  download_url: z.string(),
  expires_at: isoDateTimeSchema,
})
export type PresignDownloadResponse = z.infer<typeof presignDownloadResponseSchema>

/** `PATCH /documents/:id/files/:fileId` — `is_primary` only (§5). */
export const documentFileUpdateSchema = z.strictObject({
  is_primary: z.literal(true, {
    message: 'Only promotion to primary is supported; demote by promoting another file',
  }),
})
export type DocumentFileUpdate = z.infer<typeof documentFileUpdateSchema>

// ── Params ───────────────────────────────────────────────────────────────────

export const documentIdParamsSchema = z.object({ id: uuidSchema })

/**
 * The version precondition for `DELETE /documents/:id` — closes debt D41.
 *
 * **A query parameter rather than a body**, because a `DELETE` with a body is poorly supported and
 * `fetch` will not reliably send one. The precondition itself is the same idea as `PATCH`'s
 * ([ADR-0024](../../../docs/decisions/0024-offline-writes-outbox.md)): the client states the version
 * it last saw, and a delete built against stale data is refused with `409` instead of destroying an
 * edit made somewhere else in the meantime.
 *
 * `z.coerce` because query parameters arrive as strings; `strictObject` because
 * `conventions/api.md` §7 requires an unknown query parameter to be rejected rather than ignored —
 * a typo'd `?verison=3` must not silently become an unconditional delete.
 */
export const documentDeleteQuerySchema = z.strictObject({
  version: z.coerce.number().int().min(1),
})
export type DocumentDeleteQuery = z.infer<typeof documentDeleteQuerySchema>
export const documentFileParamsSchema = z.object({ id: uuidSchema, fileId: uuidSchema })
