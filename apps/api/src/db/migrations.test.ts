import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { expect, it } from 'vitest'
import { describeDb, withCleanDatabase } from '../test/db.js'
import { db } from './client.js'
import { migrate } from './migrate.js'

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

  it('is safe to run concurrently on a FRESH database — the advisory lock serialises it', async () => {
    /**
     * The scenario this protects against is real, not theoretical: migrations now run on **boot**
     * (ADR-0023) and Cloud Run is configured `--max-instances=3`, so two cold starts can call
     * `migrate()` at the same moment.
     *
     * **It has to be a fresh database to mean anything.** Against an already-migrated one every run
     * is a no-op and the test passes with or without the lock — which is the trap this project has
     * already fallen into once (debt D33: assertions that only ever check the empty case).
     * Verified to have teeth by removing the lock and watching it fail with
     * `relation "spaces" already exists`.
     */
    const workerUrl = process.env.DATABASE_URL
    expect(workerUrl).toBeDefined()
    if (workerUrl === undefined) return

    const target = new URL(workerUrl)
    const freshName = `lm_concurrent_${process.env.VITEST_WORKER_ID ?? '1'}`
    if (!/^[A-Za-z0-9_]+$/.test(freshName)) throw new Error('unsafe database name')

    const admin = new Client({ connectionString: workerUrl })
    await admin.connect()
    try {
      await admin.query(`drop database if exists "${freshName}"`)
      await admin.query(`create database "${freshName}"`)
    } finally {
      await admin.end()
    }

    target.pathname = `/${freshName}`
    const freshUrl = target.toString()

    try {
      const results = await Promise.allSettled([
        migrate(freshUrl),
        migrate(freshUrl),
        migrate(freshUrl),
      ])

      const reasons = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => String(result.reason).split('\n')[0])
      expect(reasons, 'a concurrent migration failed').toEqual([])

      // And it actually migrated, rather than all three no-oping for some other reason.
      const check = new Client({ connectionString: freshUrl })
      await check.connect()
      try {
        const { rows } = await check.query<{ table_name: string }>(
          `select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE'`,
        )
        expect(rows.map((row) => row.table_name)).toEqual(
          expect.arrayContaining(['documents', 'reminders', 'spaces', 'idempotency_keys']),
        )
      } finally {
        await check.end()
      }
    } finally {
      const cleanup = new Client({ connectionString: workerUrl })
      await cleanup.connect()
      try {
        await cleanup.query(`drop database if exists "${freshName}"`)
      } finally {
        await cleanup.end()
      }
    }
  })

  it('created the M1 domain tables', async () => {
    const result = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
    )

    const names = result.rows.map((row) => row.table_name)
    expect(names).toEqual(
      expect.arrayContaining(['documents', 'document_files', 'reminders', 'push_subscriptions']),
    )
  })

  it('maintains documents.search_vector as a generated column, with title outranking notes', async () => {
    // conventions/data.md §6 requires this to be GENERATED, not trigger-maintained — so that
    // no application code can forget to refresh it. The way to prove that is to write a row
    // with raw SQL that says nothing about search_vector, then search for it.
    const userId = '66666666-6666-4666-8666-666666666666'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture3@example.test', false)`,
    )
    const space = await db.execute<{ id: string }>(
      sql`insert into spaces (name, kind) values ('S', 'shared') returning id`,
    )
    const spaceId = space.rows[0]?.id
    expect(spaceId).toBeDefined()

    await db.execute(
      sql`insert into documents (space_id, created_by, title, notes, tags)
          values (${spaceId}, ${userId}, 'Passport', 'kept in the safe', '{travel}')`,
    )
    await db.execute(
      sql`insert into documents (space_id, created_by, title, notes)
          values (${spaceId}, ${userId}, 'Car insurance', 'renew before the passport trip')`,
    )

    // Both rows mention "passport" — one in its title (weight A), one in its notes (weight C).
    const ranked = await db.execute<{ title: string }>(
      sql`select title from documents
          where search_vector @@ websearch_to_tsquery('english', 'passport')
          order by ts_rank(search_vector, websearch_to_tsquery('english', 'passport')) desc`,
    )
    expect(ranked.rows.map((row) => row.title)).toEqual(['Passport', 'Car insurance'])

    // Tags are in the vector too (spec §3: notes/tags share weight C).
    const byTag = await db.execute<{ title: string }>(
      sql`select title from documents
          where search_vector @@ websearch_to_tsquery('english', 'travel')`,
    )
    expect(byTag.rows.map((row) => row.title)).toEqual(['Passport'])
  })

  it('enforces at most one primary file per document, at the database level', async () => {
    // Business rule 3 as a constraint rather than a hope — the same pattern as the personal
    // space index above, and for the same reason: the service's demote-then-promote is only
    // safe if a double-primary is impossible.
    const userId = '77777777-7777-4777-8777-777777777777'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture4@example.test', false)`,
    )
    const space = await db.execute<{ id: string }>(
      sql`insert into spaces (name, kind) values ('S', 'shared') returning id`,
    )
    const spaceId = space.rows[0]?.id
    const doc = await db.execute<{ id: string }>(
      sql`insert into documents (space_id, created_by, title)
          values (${spaceId}, ${userId}, 'Passport') returning id`,
    )
    const documentId = doc.rows[0]?.id

    const insertPrimary = (version: number) =>
      db.execute(
        sql`insert into document_files
              (space_id, created_by, document_id, version, storage_key, mime, size_bytes, is_primary)
            values (${spaceId}, ${userId}, ${documentId}, ${version}, ${`k${version}`},
                    'application/pdf', 100, true)`,
      )

    await insertPrimary(1)
    const failure = await insertPrimary(2).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure, 'a second primary file was accepted').toBeDefined()
    const cause = (failure as { cause?: { constraint?: string } }).cause
    expect(cause?.constraint).toBe('document_files_one_primary_key')
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
