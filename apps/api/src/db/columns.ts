import { timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Reusable column builders — conventions/data.md §1 expressed as code, so a new table gets
 * the universal columns by construction rather than by remembering to copy them.
 *
 * This module imports NOTHING from `./schema/`, which keeps it free of import cycles. The
 * space-scoping columns, which need foreign keys to `spaces` and `users`, live in
 * `./schema/scoped-columns.ts`.
 */

/** `uuid primary key default gen_random_uuid()`. Never serial — that leaks row counts. */
export const primaryId = () => uuid('id').primaryKey().defaultRandom()

/** `timestamptz`, always. conventions/data.md §4: store UTC with an offset, never `timestamp`. */
export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const timestamps = () => ({
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

/**
 * Soft delete. `NULL` means live. Every repository read filters this — via `scoped()`, never
 * by hand, so it cannot drift apart from the space filter (conventions/data.md §3).
 */
export const softDelete = () => ({
  deletedAt: timestamptz('deleted_at'),
})
