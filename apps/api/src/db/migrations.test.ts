import { sql } from 'drizzle-orm'
import { expect, it } from 'vitest'
import { describeDb, withCleanDatabase } from '../test/db.js'
import { db } from './client.js'

/**
 * Proves the committed migration files actually apply and that the constraints they declare
 * actually constrain.
 *
 * Debt D7 says the migration path has never been exercised. This does not close it — a first
 * *forward* migration onto existing data is still untried — but it does mean the migration
 * files are run from scratch on every `pnpm test` rather than for the first time on deploy day.
 */
describeDb('schema', () => {
  withCleanDatabase()

  it('created every foundation table with the plural snake_case names data.md §7 requires', async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )

    const names = result.rows.map((row) => row.table_name).sort()
    expect(names).toEqual(
      expect.arrayContaining([
        'accounts',
        'sessions',
        'space_members',
        'spaces',
        'users',
        'verifications',
      ]),
    )
  })

  it('enforces at most one personal space per user, at the database level', async () => {
    // This is the constraint the whole ensurePersonalSpace design rests on. If it is not here,
    // a concurrent double-signup produces two personal spaces and ADR-0006's guarantee is
    // silently false. See docs/conventions/data.md §9.
    const userId = '44444444-4444-4444-8444-444444444444'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture@example.test', false)`,
    )
    await db.execute(
      sql`insert into spaces (name, kind, personal_for_user_id)
          values ('First', 'personal', ${userId})`,
    )

    const failure = await db
      .execute(
        sql`insert into spaces (name, kind, personal_for_user_id)
            values ('Second', 'personal', ${userId})`,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(failure, 'a second personal space was accepted').toBeDefined()
    // Drizzle's own message only says "Failed query"; the constraint name is on the pg error
    // underneath. Assert the specific constraint, so this test cannot pass because of some
    // unrelated failure.
    const cause = (failure as { cause?: { constraint?: string } }).cause
    expect(cause?.constraint).toBe('spaces_personal_for_user_id_key')
  })

  it('leaves the partial index inactive for shared spaces, so a user can own many', async () => {
    const userId = '55555555-5555-4555-8555-555555555555'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture2@example.test', false)`,
    )

    await db.execute(sql`insert into spaces (name, kind) values ('House', 'shared')`)
    await db.execute(sql`insert into spaces (name, kind) values ('Holiday', 'shared')`)

    const result = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from spaces where kind = 'shared'`,
    )
    expect(result.rows[0]?.count).toBe('2')
  })
})
