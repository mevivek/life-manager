import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { primaryId, timestamptz } from '../columns.js'
import { users } from './auth.js'

/**
 * The ownership boundary. ADR-0006.
 *
 * `spaces` itself carries no `space_id` — its own `id` *is* the space id. `space_members` is
 * the join table conventions/data.md §1(a) exempts. Neither is an invariant breach; both are
 * called out here so lens 2 of the milestone review does not re-find them every time.
 */

export const spaceKind = pgEnum('space_kind', ['personal', 'shared'])
export const spaceRole = pgEnum('space_role', ['owner', 'member'])

export const spaces = pgTable(
  'spaces',
  {
    id: primaryId(),
    name: text('name').notNull(),
    kind: spaceKind('kind').notNull(),

    /**
     * Set only on a user's one personal space; NULL on every shared space.
     *
     * This column exists for exactly one reason: to make "every user has at most one personal
     * space" a **database constraint** rather than a hope. See the partial unique index below
     * and `spaces.service.ts`. Inferring the same thing from `kind = 'personal'` plus a
     * membership count is not enforceable, which is the whole point.
     *
     * It is NOT a special case for personal spaces, and ADR-0006's crux — "a personal space
     * is just a space with one member" — still holds: nothing reads this column except
     * `ensurePersonalSpace`. Do not branch on it. Do not join through it.
     */
    personalForUserId: uuid('personal_for_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),

    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (table) => [
    // The constraint that makes ensurePersonalSpace() safe under concurrency: two racing
    // calls cannot both succeed, so the second one's ON CONFLICT DO NOTHING is a no-op.
    uniqueIndex('spaces_personal_for_user_id_key')
      .on(table.personalForUserId)
      .where(sql`${table.personalForUserId} is not null`),
  ],
)

export const spaceMembers = pgTable(
  'space_members',
  {
    spaceId: uuid('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: spaceRole('role').notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.spaceId, table.userId] }),
    // Postgres does not index a foreign key automatically (conventions/data.md §2), and this
    // is the hottest query in the codebase: the actor hook runs it on every request.
    index('space_members_user_id_idx').on(table.userId),
  ],
)
