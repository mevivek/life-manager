import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { index, uuid } from 'drizzle-orm/pg-core'
import { users } from './auth.js'
import { spaces } from './spaces.js'

/**
 * The two ownership columns and the one index that conventions/data.md §1–§2 require on
 * **every domain table**. Nothing uses them at M0 — no domain table exists yet — and that is
 * the point: the first M1 table (`documents`) gets the tenant boundary by construction rather
 * than by its author remembering the rule.
 *
 * Usage, from agent-playbooks/add-a-domain.md:
 *
 *     export const documents = pgTable('documents', {
 *       id: primaryId(),
 *       ...spaceScoped(),
 *       ...timestamps(),
 *       ...softDelete(),
 *       title: text('title').notNull(),
 *     }, (t) => [spaceScopedIndex('documents', t)])
 */
export const spaceScoped = () => ({
  /** The authorization boundary. Repositories filter on it via `scoped()`; nothing else. */
  spaceId: uuid('space_id')
    .notNull()
    .references(() => spaces.id, { onDelete: 'cascade' }),

  /**
   * Provenance, NOT ownership. Useful for showing who added something in a shared space.
   * Authorization never consults it — authorization consults space membership
   * (conventions/data.md §1).
   */
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
})

/**
 * `create index on <table> (space_id) where deleted_at is null` — conventions/data.md §2.
 * Every query a repository issues filters on `space_id`, so this is the index that matters.
 */
export const spaceScopedIndex = (
  tableName: string,
  table: { spaceId: AnyPgColumn; deletedAt: AnyPgColumn },
) => index(`${tableName}_space_id_idx`).on(table.spaceId).where(sql`${table.deletedAt} is null`)

export type SpaceScopedColumns = ReturnType<typeof spaceScoped>
