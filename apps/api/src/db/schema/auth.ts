import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { timestamptz } from '../columns.js'

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  BETTER AUTH'S TABLES. Regenerate rather than edit:  pnpm --filter api auth:generate
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * conventions/data.md §9: "managed by Better Auth. Do not hand-edit its columns; extend via
 * a separate profile table if needed."
 *
 * ── Two deliberate divergences from what the CLI emits, both documented on purpose ──
 *
 * 1. **`usePlural`.** Better Auth's default table names are singular (`user`, `session`).
 *    conventions/data.md §7 requires plural snake_case, so the adapter is configured with
 *    `usePlural: true` and the tables here are `users`, `sessions`, `accounts`,
 *    `verifications`. This is a config option, not an edit.
 *
 * 2. **`id` columns are `uuid`, not `text`.** The CLI emits `text('id')`, because Better
 *    Auth's default id generator produces a 32-character random string. conventions/data.md
 *    §4 is unambiguous that identifiers are `uuid`, and §1 requires every domain table's
 *    `created_by` to be `uuid references users(id)` — a `text` user id would force that
 *    column, and every future domain table, to diverge instead. So `auth.ts` sets
 *    `advanced.database.generateId: () => crypto.randomUUID()` and these columns are `uuid`.
 *    A Better Auth plugin that ever generates a non-UUID id will fail the insert loudly,
 *    which is the failure mode we want. Registered as debt (docs/product/review.md D14).
 *
 * ── Why there is no `space_id` here, and why that is not an invariant breach ──
 *
 * conventions/data.md §1 requires `space_id` on every **domain** table. These are not domain
 * tables; they are the identity substrate that `space_members.user_id` points at. A
 * `space_id` on `users` would be circular — you cannot be a member of a space before you
 * exist. Lens 2 of the milestone review checks for exactly this pattern, so it is stated
 * here rather than rediscovered as a finding every milestone.
 */

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    token: text('token').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('sessions_token_key').on(table.token)],
)

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamptz('access_token_expires_at'),
  refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
  scope: text('scope'),
  /** bcrypt/scrypt hash, written and read only by Better Auth. Never logged (see logger.ts). */
  password: text('password'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamptz('expires_at').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
})
