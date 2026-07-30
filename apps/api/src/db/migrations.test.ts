import { getTableName, is, sql, Table } from 'drizzle-orm'
import { Client } from 'pg'
import { expect, it } from 'vitest'
import { describeDb, withCleanDatabase } from '../test/db.js'
import { db } from './client.js'
import { migrate } from './migrate.js'
import * as schema from './schema/index.js'

/**
 * Proves the committed migration files actually apply and that the constraints they declare
 * actually constrain.
 *
 * Debt D7 says the migration path has never been exercised. This does not close it — a first
 * *forward* migration onto existing data is still untried — but it does mean the migration
 * files are run from scratch on every `pnpm test` rather than for the first time on deploy day.
 */

/**
 * Every table the barrel exports, by its **SQL** name — reflected, never listed.
 *
 * ── Why reflection rather than the hand-written arrays this replaced ──
 *
 * Three tests here used to assert `expect.arrayContaining([...])` against arrays typed out by
 * hand: one for the foundation tables, one for M1's, one for Things'. Each was correct on the day
 * it was written and each was inert afterwards — a fourth domain adds a table and no list mentions
 * it, so the suite has no opinion about whether it reached the database. That is the same defect
 * as a hand-maintained test count in CLAUDE.md, and the same defect as debt D33: an assertion that
 * can only pass.
 *
 * `getTableName` reads the name Drizzle itself will use in SQL, so this set is exactly what
 * `drizzle-kit` sees — which is the point. A table defined in a domain folder and never
 * re-exported from `db/schema/index.ts` is invisible to the barrel, hence to the generator, hence
 * missing in production while every local test passes. `scripts/check-schema-barrel.mjs` catches
 * that statically with no database; this catches it against a real one, having actually run the
 * migrations.
 */
function barrelTableNames(): string[] {
  // Widened to `unknown` first: the barrel also exports `pgEnum`s and helpers, and TypeScript will
  // not accept a predicate narrowing to `Table` against that literal union of concrete table types.
  return (Object.values(schema) as unknown[])
    .filter((value): value is Table => is(value, Table))
    .map((table) => getTableName(table))
    .sort()
}

async function publicTableNames(client?: Client): Promise<string[]> {
  const query = `select table_name from information_schema.tables
                 where table_schema = 'public' and table_type = 'BASE TABLE'`
  const rows = client
    ? (await client.query<{ table_name: string }>(query)).rows
    : (await db.execute<{ table_name: string }>(sql.raw(query))).rows
  return rows.map((row) => row.table_name).sort()
}

describeDb('schema', () => {
  withCleanDatabase()

  it('the barrel and the database agree about every table, in both directions', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  The reflective replacement for three hand-maintained table lists. See `barrelTableNames`.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * **The `public` filter is what makes the second direction clean rather than noisy.** Two other
     * things create tables in this database and neither belongs to the barrel: pg-boss puts its ~10
     * tables in the `pgboss` schema (`jobs/boss.ts`, deliberately, so a `drizzle-kit push` cannot
     * offer to drop the queue), and Drizzle's own `__drizzle_migrations` journal lives in the
     * `drizzle` schema. Both are therefore excluded by the schema predicate rather than by an
     * ignore list that would have to be maintained — which is the failure this whole test is a
     * reaction to. If a future dependency does put a table in `public`, this test fails and names
     * it, and the right answer then is a *named* exemption with a comment, not a widened filter.
     */
    const barrel = barrelTableNames()
    const database = await publicTableNames()

    const missingFromDatabase = barrel.filter((name) => !database.includes(name))
    expect(
      missingFromDatabase,
      'in the barrel but NOT in the database: the migration for it was never generated, ' +
        'or the re-export was added without running `pnpm --filter @life-manager/api db:generate`',
    ).toEqual([])

    const missingFromBarrel = database.filter((name) => !barrel.includes(name))
    expect(
      missingFromBarrel,
      'in the database but NOT in the barrel: a migration created a table no Drizzle schema ' +
        'describes, so the query builder cannot see it and the next `db:generate` may drop it',
    ).toEqual([])

    // conventions/data.md §7: snake_case. Plurality is a convention no regex can check honestly,
    // so it stays a review matter — this half is the half that can be enforced.
    expect(barrel.filter((name) => !/^[a-z][a-z0-9_]*$/.test(name))).toEqual([])

    /**
     * A non-zero FLOOR, last — debt D33's rule applied to the reflection itself.
     *
     * The two diffs above already catch an empty barrel loudly (every database table shows up as
     * `missingFromBarrel`), so this is a backstop for the one case they cannot see: a run where
     * *both* sets are empty because neither the reflection nor the migrations did anything. It is a
     * floor and not an inventory — the number it must not silently fall below, not the number of
     * tables. Adding a domain does not require touching it.
     */
    expect(
      barrel.length,
      'reflected almost nothing — `is(value, Table)` may have stopped narrowing',
    ).toBeGreaterThanOrEqual(14)
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
      // Reflected against the barrel rather than against four names picked by hand, for the
      // reason `barrelTableNames` gives: a list of four cannot notice a fifth going missing.
      const check = new Client({ connectionString: freshUrl })
      await check.connect()
      try {
        const created = await publicTableNames(check)
        expect(barrelTableNames().filter((name) => !created.includes(name))).toEqual([])
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

  /*
    Removed here: `created the M1 domain tables` and `created the Things tables`.

    Both were `expect.arrayContaining([...])` over names typed out by hand, and both are subsumed
    — strictly, not approximately — by the bidirectional test above: every name they listed is a
    barrel export, and the barrel is now asserted whole. Deleting them removes two lists that would
    have said nothing about M4's next domain. No assertion was weakened; one that could only ever
    grow stale was replaced by one that cannot.
  */

  it('rule 5: documents.thing_id is ON DELETE SET NULL, not cascade', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  things.md §4 rule 5, asserted at the DATABASE level rather than through the API.
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * `things.test.ts` covers the delete a user can actually perform, which is a **soft** delete —
     * the service clears `documents.thing_id` in application code, because `on delete set null` does
     * not fire for an `UPDATE … SET deleted_at`.
     *
     * That leaves the constraint itself untested by any API-level test, and it is the half that
     * matters if a row is ever genuinely purged (account deletion, conventions/data.md §3). So this
     * hard-deletes the row and checks the outcome. A `cascade` here would let one purge destroy a
     * passport-adjacent archive because somebody sold a car — and the copy on the delete control
     * ("its documents stay in Documents") would be a lie.
     */
    const userId = '88888888-8888-4888-8888-888888888888'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture5@example.test', false)`,
    )
    const space = await db.execute<{ id: string }>(
      sql`insert into spaces (name, kind) values ('S', 'shared') returning id`,
    )
    const spaceId = space.rows[0]?.id
    const thing = await db.execute<{ id: string }>(
      sql`insert into things (space_id, created_by, name, kind)
          values (${spaceId}, ${userId}, 'Car', 'vehicle') returning id`,
    )
    const thingId = thing.rows[0]?.id
    expect(thingId).toBeDefined()

    await db.execute(
      sql`insert into documents (space_id, created_by, title, thing_id)
          values (${spaceId}, ${userId}, 'Car registration', ${thingId})`,
    )

    await db.execute(sql`delete from things where id = ${thingId}`)

    const survivors = await db.execute<{ title: string; thing_id: string | null }>(
      sql`select title, thing_id from documents where space_id = ${spaceId}`,
    )
    // The document SURVIVES, with the link cleared. Both halves matter: an empty result set would
    // mean a cascade, and a non-null `thing_id` is impossible but would mean the FK is absent.
    expect(survivors.rows).toEqual([{ title: 'Car registration', thing_id: null }])
  })

  it('rejects a document linked to a thing that does not exist', async () => {
    // The other direction of the same constraint. Before it existed, `documents.thing_id` could hold
    // any uuid — which is why `documents.test.ts` used fabricated ones and why migration 0007 nulls
    // any dangling value before adding the constraint.
    const userId = '99999999-9999-4999-8999-999999999999'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture6@example.test', false)`,
    )
    const space = await db.execute<{ id: string }>(
      sql`insert into spaces (name, kind) values ('S', 'shared') returning id`,
    )
    const spaceId = space.rows[0]?.id

    const failure = await db
      .execute(
        sql`insert into documents (space_id, created_by, title, thing_id)
            values (${spaceId}, ${userId}, 'Orphan',
                    '2a000000-0000-4000-8000-00000000000a')`,
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      )

    expect(failure, 'a dangling thing_id was accepted').toBeDefined()
    const cause = (failure as { cause?: { constraint?: string } }).cause
    expect(cause?.constraint).toBe('documents_thing_id_things_id_fk')
  })

  it('enforces at most one CONFIRMED hero photo per thing, at the database level', async () => {
    /**
     * things.md §3's partial unique index, and the `uploaded_at is not null` half of it — which is not
     * decoration. `make_hero` is declared at presign time, so an unconfirmed row carries the flag as
     * an *intention*; if the index looked at `is_hero` alone, one abandoned upload would occupy the
     * hero slot forever and the next real upload would be rejected by Postgres.
     *
     * So this asserts both: two unconfirmed heroes are fine, two confirmed ones are not.
     */
    const userId = '12121212-1212-4212-8212-121212121212'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture7@example.test', false)`,
    )
    const space = await db.execute<{ id: string }>(
      sql`insert into spaces (name, kind) values ('S', 'shared') returning id`,
    )
    const spaceId = space.rows[0]?.id
    const thing = await db.execute<{ id: string }>(
      sql`insert into things (space_id, created_by, name)
          values (${spaceId}, ${userId}, 'Dishwasher') returning id`,
    )
    const thingId = thing.rows[0]?.id

    const insertHero = (key: string, confirmed: boolean) =>
      db.execute(
        sql`insert into thing_photos
              (space_id, created_by, thing_id, storage_key, mime, size_bytes, is_hero, uploaded_at)
            values (${spaceId}, ${userId}, ${thingId}, ${key}, 'image/jpeg', 100, true,
                    ${confirmed ? sql`now()` : sql`null`})`,
      )

    // Two unconfirmed intentions: allowed, because neither can be displayed.
    await insertHero('k-unconfirmed-1', false)
    await insertHero('k-unconfirmed-2', false)

    await insertHero('k-confirmed-1', true)
    const failure = await insertHero('k-confirmed-2', true).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(failure, 'a second confirmed hero was accepted').toBeDefined()
    const cause = (failure as { cause?: { constraint?: string } }).cause
    expect(cause?.constraint).toBe('thing_photos_one_hero_key')
  })

  it('maintains things.search_vector as a generated column, with the name outranking notes', async () => {
    // conventions/data.md §6 requires this to be GENERATED, not trigger-maintained, so that no
    // application code can forget to refresh it. The way to prove that is to write a row with raw SQL
    // that says nothing about search_vector, then search for it.
    const userId = '13131313-1313-4313-8313-131313131313'
    await db.execute(
      sql`insert into users (id, name, email, email_verified)
          values (${userId}, 'Fixture', 'fixture8@example.test', false)`,
    )
    const space = await db.execute<{ id: string }>(
      sql`insert into spaces (name, kind) values ('S', 'shared') returning id`,
    )
    const spaceId = space.rows[0]?.id

    await db.execute(
      sql`insert into things (space_id, created_by, name, brand, kept_at)
          values (${spaceId}, ${userId}, 'Dishwasher', 'Bosch', 'Kitchen')`,
    )
    await db.execute(
      sql`insert into things (space_id, created_by, name, notes)
          values (${spaceId}, ${userId}, 'Extended cover', 'covers the dishwasher')`,
    )

    // Both rows mention "dishwasher" — one in its name (weight A), one in its notes (weight C).
    const ranked = await db.execute<{ name: string }>(
      sql`select name from things
          where search_vector @@ websearch_to_tsquery('english', 'dishwasher')
          order by ts_rank(search_vector, websearch_to_tsquery('english', 'dishwasher')) desc`,
    )
    expect(ranked.rows.map((row) => row.name)).toEqual(['Dishwasher', 'Extended cover'])

    // `brand` (weight B) and `kept_at` (weight C) are in the vector too — things.md §3.
    const byBrand = await db.execute<{ name: string }>(
      sql`select name from things
          where search_vector @@ websearch_to_tsquery('english', 'bosch')`,
    )
    expect(byBrand.rows.map((row) => row.name)).toEqual(['Dishwasher'])
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
