import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { primaryId, timestamptz } from '../columns.js'
import { users } from './auth.js'
import { spaces } from './spaces.js'

/**
 * `Idempotency-Key` replay cache. conventions/api.md §5, closing debt **D9** — documented since
 * M0 and unimplemented because M0 shipped no mutation of its own. M1's `POST /documents` is the
 * trigger the register named.
 *
 * Infrastructure rather than a domain table, so it lives in `db/schema/` alongside the other
 * cross-domain tables rather than in one domain's folder. It carries `space_id` anyway
 * (conventions/data.md §1): a replay must never cross a tenant boundary, and scoping the lookup
 * by space means a key guessed from another space simply does not match.
 *
 * **No `deleted_at`.** Nothing here is user-visible or user-deletable, and rows expire by age
 * rather than being soft-deleted — so `scoped()` deliberately does not apply, and the two
 * queries against this table filter `space_id` explicitly with a comment saying why.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: primaryId(),

    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),

    /** The client's `Idempotency-Key` header, verbatim. */
    key: text('key').notNull(),

    /**
     * `METHOD /route/pattern` — the *route*, not the resolved URL, so `/documents/:id` is one
     * endpoint rather than one per document. §5 keys the cache on "key + endpoint + actor".
     */
    endpoint: text('endpoint').notNull(),

    /**
     * SHA-256 of the canonical request body. §5: the same key with a **different** body is a
     * `409` — that is a client bug (a key reused for a different operation) and silently
     * replaying the first response would hide it.
     */
    requestHash: text('request_hash').notNull(),

    /**
     * `null` while the first request is still in flight. A second request arriving in that
     * window gets a 409 rather than a duplicate write: the row is claimed before the handler
     * runs, so the race is decided by the unique index below rather than by timing.
     */
    statusCode: integer('status_code'),
    responseBody: jsonb('response_body'),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    /**
     * The claim. `insert … on conflict do nothing` against this index is what makes the whole
     * mechanism safe under concurrency — exactly the pattern `ensurePersonalSpace` uses, and for
     * the same reason (conventions/data.md §9): a constraint, not a check-then-act.
     */
    uniqueIndex('idempotency_keys_scope_key').on(table.spaceId, table.key, table.endpoint),
  ],
)
