import type { CustomAttrs } from '@life-manager/shared'
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { primaryId, timestamps, timestamptz } from '../../db/columns.js'
import { spaceScoped, spaceScopedIndex } from '../../db/schema/scoped-columns.js'
import { tsvector } from '../../db/schema/tsvector.js'

/**
 * The Documents tables. Spec: domains/documents.md §3.
 *
 * Re-exported from `db/schema/index.ts`, which is the single barrel `drizzle.config.ts` and
 * `db/client.ts` read. The tables live *here*, in the domain folder, per
 * agent-playbooks/add-a-domain.md §3 and conventions/code.md §3 — one folder per domain, not
 * schema files scattered away from the code that queries them.
 */

/** conventions/data.md §4: a Postgres enum, since this taxonomy is stable (spec §3). */
export const docType = pgEnum('doc_type', [
  'identity',
  'financial',
  'legal',
  'warranty',
  'receipt',
  'certificate',
  'other',
])

export const reminderChannel = pgEnum('reminder_channel', ['web_push', 'email', 'fcm', 'apns'])

export const documents = pgTable(
  'documents',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    deletedAt: timestamptz('deleted_at'),

    /** The only field required at capture — Q2, business rule 1. */
    title: text('title').notNull(),

    /**
     * Defaults to `other` at the database level as well as in Zod. A document with no type is
     * a normal, expected state (Q2), so the column is `not null` with a default rather than
     * nullable — "untyped" is a value, not an absence.
     */
    docType: docType('doc_type').notNull().default('other'),

    issuer: text('issuer'),

    /**
     * **Last 4 characters only** — business rule 6. The full passport or account number lives
     * on the scan, which is access-controlled. A plaintext column holding the whole number is
     * a needless liability, so the API truncates before this ever sees a value.
     */
    identifierLast4: text('identifier_last4'),

    issuedOn: date('issued_on'),

    /**
     * `date`, **not** `timestamptz` — conventions/data.md §4. A passport expires on a day, not
     * at an instant, and getting this wrong makes reminders fire in the wrong timezone.
     */
    expiresOn: date('expires_on'),

    country: char('country', { length: 2 }),
    notes: text('notes'),

    /** `text[]`, never a comma-joined string (conventions/data.md §4). */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),

    /**
     * Type-varying fields. Flexible in the database, **not** in the contract: a Zod schema per
     * `doc_type` validates it at the API edge (conventions/data.md §5), so a client cannot
     * write arbitrary keys.
     */
    customAttrs: jsonb('custom_attrs').$type<CustomAttrs>().notNull().default({}),

    /**
     * Generated, not trigger-maintained — conventions/data.md §6. Postgres keeps it correct
     * with no application code to forget, which matters in a codebase edited by sessions that
     * have never seen each other's work.
     *
     * Weighted per spec §3: title **A**, issuer **B**, notes and tags **C**, so a title match
     * outranks a note match.
     *
     * **Every expression here must be IMMUTABLE**, which is a narrower set than it looks:
     *
     * - `to_tsvector('english', …)` — the two-argument form is immutable; the *one*-argument
     *   form is only STABLE, because it reads `default_text_search_config`. Always pass the
     *   config literal.
     * - **`array_to_string(tags, ' ')` is STABLE and will not compile here.** It was the first
     *   thing tried, and Postgres rejects the whole table with `generation expression is not
     *   immutable` — element output functions are not guaranteed immutable. `array_to_tsvector`
     *   is immutable and is the right tool.
     *
     * `array_to_tsvector` produces lexemes **verbatim** — no stemming, no case folding, and no
     * positions. Two consequences, both fine and both deliberate:
     *
     * 1. Tags must already be lowercase to match a lowercased query lexeme. `tagSchema` in
     *    `packages/shared` lowercases them, so the contract guarantees it rather than the
     *    caller remembering.
     * 2. A positionless lexeme cannot carry a weight, so `setweight` is a no-op on the tag
     *    half and tags rank *below* weight-C text rather than equal to it. Matching is
     *    unaffected, which is what `?tag=` and `?q=` actually need.
     */
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(issuer, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(notes, '')), 'C') ||
          array_to_tsvector(tags)`,
    ),
  },
  (table) => [
    spaceScopedIndex('documents', table),
    /**
     * The dominant sort (conventions/data.md §2) and the reminder scan's access path. Spec §5:
     * the default list order is `expires_on asc, nulls last`, because "what needs doing about
     * it" is the question this domain exists to answer.
     */
    index('documents_space_id_expires_on_idx')
      .on(table.spaceId, table.expiresOn)
      .where(sql`${table.deletedAt} is null`),
    index('documents_search_vector_idx').using('gin', table.searchVector),
    /** `?tag=` is an array containment filter, which needs GIN to avoid a sequential scan. */
    index('documents_tags_idx').using('gin', table.tags),
  ],
)

export const documentFiles = pgTable(
  'document_files',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    deletedAt: timestamptz('deleted_at'),

    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),

    /** Monotonic per document, **assigned by the server** — business rule 4. */
    version: integer('version').notNull(),

    /**
     * **Chosen by the API, never by a client** — invariant 6, business rule 5, ADR-0008.
     * Shape: `spaces/{spaceId}/documents/{documentId}/{fileId}`. Not exposed in any response
     * schema, so nothing teaches a client to construct one.
     */
    storageKey: text('storage_key').notNull(),

    mime: text('mime').notNull(),

    /** `bigint`: a 25 MB limit today, but the column should not be the thing that has to change. */
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),

    /** Integrity, and the raw material for duplicate detection (spec §9 question 5). */
    sha256: text('sha256'),

    isPrimary: boolean('is_primary').notNull().default(false),

    /**
     * `null` until the client confirms the upload. A row still null after 24 hours is
     * abandoned and swept, along with its orphaned R2 object — business rule 10.
     */
    uploadedAt: timestamptz('uploaded_at'),
  },
  (table) => [
    spaceScopedIndex('document_files', table),
    // Postgres does not index a foreign key automatically (conventions/data.md §2).
    index('document_files_document_id_idx').on(table.documentId),
    uniqueIndex('document_files_document_id_version_key').on(table.documentId, table.version),
    /**
     * Business rule 3 as a **constraint**, not a hope: at most one primary file per document.
     * Partial, so demoted and soft-deleted rows do not occupy the slot — which is what lets
     * the service demote-then-promote inside one transaction.
     */
    uniqueIndex('document_files_one_primary_key')
      .on(table.documentId)
      .where(sql`${table.isPrimary} and ${table.deletedAt} is null`),
    /** The abandoned-upload sweep (business rule 10) scans exactly this. */
    index('document_files_unconfirmed_idx')
      .on(table.createdAt)
      .where(sql`${table.uploadedAt} is null and ${table.deletedAt} is null`),
  ],
)

/**
 * **Generic on purpose** — keyed by `entity_type` + `entity_id` rather than owned by Documents,
 * so Assets and Money (M4) reuse this table instead of each inventing their own (spec §3).
 *
 * There is deliberately **no foreign key** on `entity_id`: it is polymorphic, so Postgres
 * cannot enforce one. Spec §9 question 4 records that trade honestly, and the orphan sweep in
 * `jobs/reminders.ts` is the price paid for it.
 */
export const reminders = pgTable(
  'reminders',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    deletedAt: timestamptz('deleted_at'),

    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),

    /** `date`, for the same reason as `expires_on` — conventions/data.md §4. */
    dueOn: date('due_on').notNull(),

    /** Fires at `due_on - lead_days`. Several rows on one entity = several lead times. */
    leadDays: integer('lead_days').notNull().default(0),

    channel: reminderChannel('channel').notNull().default('web_push'),

    /** `null` = pending. This column **is** the delivery job's idempotency key. */
    sentAt: timestamptz('sent_at'),

    dismissedAt: timestamptz('dismissed_at'),
  },
  (table) => [
    spaceScopedIndex('reminders', table),
    /**
     * The daily scan (spec §3, §6). Partial on `sent_at is null` keeps the index the size of
     * the *pending* set rather than of all history — which is the difference between a scan
     * that stays fast for years and one that degrades quietly.
     */
    index('reminders_due_idx')
      .on(table.dueOn)
      .where(sql`${table.sentAt} is null and ${table.deletedAt} is null`),
    /** Listing one document's reminders, and the orphan sweep. */
    index('reminders_entity_idx').on(table.entityType, table.entityId),
  ],
)

/**
 * Web Push endpoints, one row per browser install that granted permission.
 *
 * **Space-scoped like every other table** (invariant 2), even though a subscription feels
 * user-shaped. That is the right model rather than a concession: a reminder belongs to a space,
 * so delivery has to resolve "who should hear about this space's reminders", and at M3 that
 * becomes several people with no code change. `created_by` records which member's browser it
 * is — provenance, not ownership (conventions/data.md §1).
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: primaryId(),
    ...spaceScoped(),
    ...timestamps(),
    deletedAt: timestamptz('deleted_at'),

    /** The browser's push endpoint URL. Unique — re-subscribing must not duplicate delivery. */
    endpoint: text('endpoint').notNull(),

    /**
     * The subscription's public key and auth secret, from `PushSubscription.toJSON()`.
     *
     * Not a credential of ours and not sensitive in the way a session token is — they are the
     * *recipient's* half of the ECDH exchange, useless without the endpoint, and the browser
     * hands them out to any origin the user subscribes to. The VAPID **private** key is the
     * secret here, and it lives in the environment, never in a table.
     */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),

    /** Set when a push fails with 404/410 — the endpoint is gone and must stop being tried. */
    expiredAt: timestamptz('expired_at'),
  },
  (table) => [
    spaceScopedIndex('push_subscriptions', table),
    uniqueIndex('push_subscriptions_endpoint_key').on(table.endpoint),
  ],
)
