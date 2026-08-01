import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { primaryId, softDelete, timestamps, timestamptz, versioned } from '../../db/columns.js'
import { spaceScoped, spaceScopedIndex } from '../../db/schema/scoped-columns.js'
import { tsvector } from '../../db/schema/tsvector.js'

/**
 * The Things tables. Spec: domains/things.md §3, decided by
 * [ADR-0029](../../../../../docs/decisions/0029-the-things-domain.md).
 *
 * Re-exported from `db/schema/index.ts`, which is the single barrel `drizzle.config.ts` and
 * `db/client.ts` read — a table missing from it does not exist as far as migrations or the query
 * builder are concerned, and the failure is a silently absent table rather than an error
 * (agent-playbooks/add-a-domain.md §3).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  COVER IS NOT EXPIRY, and no column here is named as though it were.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `warranty_ends_on` is the end of a *span*, not a validity cliff: a dishwasher whose warranty has
 * ended keeps washing dishes. That is why there is no `expires_on` on this table and why nothing
 * here may be joined into the expiry ladder — things.md §4 rule 2, design.md §2a.
 */

/**
 * conventions/data.md §4: a Postgres enum, because this taxonomy is settled (things.md §3).
 *
 * Ten kinds, and the tenth is the escape hatch — `other` exists so nothing is unfileable and is
 * absent from the capture chips so it is never *chosen* (`CAPTURE_KINDS` in
 * `packages/shared/src/things.ts`). Same shape as `doc_type: 'other'`.
 */
export const thingKind = pgEnum('thing_kind', [
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

/**
 * Ownership — things.md §4 rule 4. **A state, never a delete.**
 *
 * `lent` is still yours and elsewhere; `gone` is sold or given away and the record **stays**,
 * because proving what you handed over and when is a large part of why anyone files a receipt.
 * Neither is a deletion, which is why this is an enum on the row rather than a `deleted_at`.
 */
export const thingOwnership = pgEnum('thing_ownership', ['here', 'lent', 'gone'])

export const things = pgTable(
  'things',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    ...softDelete(),
    /** Optimistic concurrency — ADR-0024. A stale `PATCH` or `DELETE` is refused with 409. */
    ...versioned(),

    /** The only field required at capture — Q2 applied to a second domain, business rule 1. */
    name: text('name').notNull(),

    /**
     * `not null` with a default, exactly like `documents.doc_type`: a thing with no kind chosen is
     * a normal, expected state (Q2), so "untyped" is a *value* rather than an absence.
     */
    kind: thingKind('kind').notNull().default('other'),

    /** The make. Free text with suggestions, never a foreign key — things.md §9(1). */
    brand: text('brand'),
    model: text('model'),

    /**
     * The **full** serial — IMEI, registration, hallmark, order number. What it is *called*
     * depends on the kind (`SERIAL_LABELS`, business rule 8); what it *is* is one column.
     *
     * Plaintext, by the same explicit decision as `documents.identifier` (business rule 7,
     * invariant 7, ADR-0009): application-level encryption is reserved for the vault and this is
     * not the vault. **So no copy in the app may say this is encrypted** (the trap debt D44
     * names), and `serial` is in pino's `REDACTED_PATHS` beside `identifier` — what must never
     * reach a log is a whole registration number, not its last four characters.
     */
    serial: text('serial'),

    /*
     * `serial_last4` was here, mirroring `documents.identifier_last4` — a derived copy of the last
     * four characters of `serial`. Both were dropped by ADR-0036: serials are shown in full by
     * default, and the mask a device asks for is cut from the value in the same response. Do not
     * re-add it.
     */

    /** Starts the cover clock and drives the age line on the detail screen. */
    purchasedOn: date('purchased_on'),

    /**
     * What was paid. `numeric(19,4)` plus a separate currency, **never a float**
     * (conventions/data.md §4) — and `mode: 'string'` so the value never becomes a float in
     * JavaScript either, which is what `decimalStringSchema` exists to carry over the wire.
     *
     * Not what it is worth today: depreciation and resale are Money's business (things.md §2).
     */
    price: numeric('price', { precision: 19, scale: 4, mode: 'string' }),
    currency: char('currency', { length: 3 }),

    /** `null` means **no cover recorded**, which is a normal state and not a gap. */
    warrantyEndsOn: date('warranty_ends_on'),

    /** The cycle length in months. `null` means this thing has no service cycle at all. */
    serviceEveryMonths: integer('service_every_months'),

    /**
     * The next service. **Derived** from the newest `thing_services` row plus the interval
     * whenever a service is logged (business rule 3) — but settable directly too, because a thing
     * with a cycle and an empty log needs a seed until the first service is logged.
     */
    serviceDueOn: date('service_due_on'),

    /** "Driveway", "Kitchen cupboard". A memory aid, not an address. */
    keptAt: text('kept_at'),

    /**
     * Whose it is, as a **label**. Identical semantics to `documents.holder` — business rule 6,
     * and documents.md §4 rule 13 is the authority rather than this comment.
     *
     * `null` means the owner's own, and is drawn as *absence*: there is no "Me" badge anywhere.
     * **It is never a permission.** `scoped()` is still the only thing deciding what a caller may
     * read (invariants 2 and 3); a holder is a word on a row.
     */
    holder: text('holder'),

    /** Cosmetic gloss on `holder`, and `null` whenever `holder` is. One helper writes both. */
    relation: text('relation'),

    ownership: thingOwnership('ownership').notNull().default('here'),

    /** Who has it, or who it went to. Free text, and optional even when not `here`. */
    ownershipWho: text('ownership_who'),
    ownershipSince: date('ownership_since'),

    notes: text('notes'),

    /**
     * Generated, not trigger-maintained — conventions/data.md §6. Weighted per things.md §3:
     * name **A**, brand and model **B**, notes and `kept_at` **C**, so a name match outranks a
     * note match.
     *
     * **Every expression here must be IMMUTABLE.** The two-argument `to_tsvector('english', …)`
     * is; the one-argument form reads `default_text_search_config` and is only STABLE, which
     * Postgres rejects with `generation expression is not immutable`. There is no text array on
     * this table, so `array_to_tsvector` (the other half of that lesson) does not come up here.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(brand, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(model, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(notes, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(kept_at, '')), 'C')`,
    ),
  },
  (table) => [
    spaceScopedIndex('things', table),
    /**
     * The two dated access paths things.md §3 names. **Not one composite over both**: the
     * cross-domain Now horizon and the reminder scan each read one of these columns, and a
     * `(space_id, warranty_ends_on, service_due_on)` index would only serve the first.
     *
     * There is deliberately no `(space_id, name)` index for the default sort. Alphabetical is the
     * default *because* a thing has no single ordering date (things.md §5), and a household's
     * inventory is tens of rows — an index for a sort over that is cost with no measurable win.
     * Add one when a real archive makes the sort visible in a query plan.
     */
    index('things_space_id_warranty_ends_on_idx')
      .on(table.spaceId, table.warrantyEndsOn)
      .where(sql`${table.deletedAt} is null`),
    index('things_space_id_service_due_on_idx')
      .on(table.spaceId, table.serviceDueOn)
      .where(sql`${table.deletedAt} is null`),
    index('things_search_vector_idx').using('gin', table.searchVector),
  ],
)

/**
 * The service log — things.md §3. **A cycle, not a date** (business rule 3): the newest row here
 * plus `things.service_every_months` is what `things.service_due_on` is recomputed from.
 *
 * No `version` column: rows are appended and removed, never edited, so there is no lost update to
 * lose (see `versioned()` in `db/columns.ts`). It grows one the moment a service becomes editable.
 */
export const thingServices = pgTable(
  'thing_services',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    ...softDelete(),

    thingId: uuid('thing_id')
      .notNull()
      .references(() => things.id, { onDelete: 'cascade' }),

    /** `date`, not `timestamptz` — a service happened on a day (conventions/data.md §4). */
    servicedOn: date('serviced_on').notNull(),

    /** Money, so `numeric` + a currency and never a float (conventions/data.md §4). */
    cost: numeric('cost', { precision: 19, scale: 4, mode: 'string' }),
    currency: char('currency', { length: 3 }),

    /** "VW Kilburn", "Plumbcraft". Free text — a memory aid, not a supplier record. */
    provider: text('provider'),
    notes: text('notes'),
  },
  (table) => [
    spaceScopedIndex('thing_services', table),
    /**
     * Postgres does not index a foreign key automatically (conventions/data.md §2), and this is
     * also the log's dominant read: newest first, per thing. things.md §3 names exactly this.
     */
    index('thing_services_thing_id_serviced_on_idx').on(table.thingId, table.servicedOn.desc()),
  ],
)

/**
 * A thing's photos. **Deliberately not `document_files`** — things.md §3.
 *
 * A photo of a boiler is not a new scan of a document, so there is no `version`, no monotonic
 * numbering and no OCR. Everything else about it is the same, and it shares `storage_key`'s shape
 * and the presign contract (ADR-0008).
 */
export const thingPhotos = pgTable(
  'thing_photos',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    ...softDelete(),

    thingId: uuid('thing_id')
      .notNull()
      .references(() => things.id, { onDelete: 'cascade' }),

    /**
     * **Chosen by the API, never by a client** — invariant 6, ADR-0008. Shape:
     * `spaces/{spaceId}/things/{thingId}/{photoId}`. Absent from every response schema, so
     * nothing teaches a client to construct one.
     */
    storageKey: text('storage_key').notNull(),

    /** The image half of the document allowlist, minus PDF — business rule 11. */
    mime: text('mime').notNull(),

    /** `bigint`: a 25 MB limit today, but the column should not be the thing that has to change. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),

    sha256: text('sha256'),

    /** The one shown at the top of the detail screen and as the list thumbnail. */
    isHero: boolean('is_hero').notNull().default(false),

    /** `null` until the client confirms the upload. */
    uploadedAt: timestamptz('uploaded_at'),
  },
  (table) => [
    spaceScopedIndex('thing_photos', table),
    // Postgres does not index a foreign key automatically (conventions/data.md §2).
    index('thing_photos_thing_id_idx').on(table.thingId),
    /**
     * things.md §3's "partial unique: one `is_hero = true` per thing", **plus
     * `uploaded_at is not null`** — and that extra predicate is load-bearing rather than tidy.
     *
     * `document_files` can index on `is_primary` alone because nothing sets that column until
     * `:confirm`. Here the client states its intent at **presign** time (`make_hero` on
     * `presignPhotoUploadRequestSchema`, which the contract already fixes), so the flag is written
     * before any bytes exist. Without `uploaded_at is not null` an abandoned upload would occupy
     * the hero slot with a photo that cannot be displayed, and the *next* real upload asking to be
     * hero would be rejected by this index.
     *
     * So: an unconfirmed row may carry the flag as an intention, and only a confirmed one can hold
     * the slot. `things.photos.service.ts` demotes the confirmed siblings inside the confirming
     * transaction, which is what keeps this satisfiable.
     */
    uniqueIndex('thing_photos_one_hero_key')
      .on(table.thingId)
      .where(
        sql`${table.isHero} and ${table.uploadedAt} is not null and ${table.deletedAt} is null`,
      ),
    /** The abandoned-upload sweep, mirroring `document_files_unconfirmed_idx`. */
    index('thing_photos_unconfirmed_idx')
      .on(table.createdAt)
      .where(sql`${table.uploadedAt} is null and ${table.deletedAt} is null`),
  ],
)
