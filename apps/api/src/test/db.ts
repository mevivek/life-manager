import { getTableName, is, sql } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { beforeEach, describe, inject } from 'vitest'
import { db } from '../db/client.js'
import * as schema from '../db/schema/index.js'

/**
 * Helpers for suites that need a real Postgres.
 *
 * Import `describeDb` instead of `describe`. When no database is available the suite skips
 * with its name still listed, which is visibly different from the suite not existing — see
 * `global-setup.ts` for why that is a skip and not a failure (ADR-0018).
 */

const databaseUrl = inject('databaseUrl')

export const hasTestDatabase = databaseUrl !== null

export const describeDb: typeof describe | typeof describe.skip = hasTestDatabase
  ? describe
  : describe.skip

/**
 * Every table the schema barrel exports, **reflected, never listed**.
 *
 * ── Why this is not the hand-written list it replaces ──
 *
 * `truncateAll()` used to name its fourteen tables in a `truncate table …` literal, with a comment
 * saying that forgetting to add one "shows up as a test that pollutes the next one rather than as
 * mystery flakiness". Those are the same thing seen from two ends: nothing tells you the list is
 * short, so what you actually get is an order-dependent pass and a flake nobody can reproduce. It
 * is the same defect class `migrations.test.ts` just removed from its three `arrayContaining([…])`
 * lists, and the same as debt D33 — an assertion, or here a cleanup, that can only look correct.
 *
 * `getTableName` reads the name Drizzle itself will use in SQL, so this set is exactly what the
 * query builder and `drizzle-kit` see. **A new domain table is truncated the moment it is
 * re-exported from the barrel** — and a table that is *not* re-exported is invisible to Drizzle
 * anyway, which `scripts/check-schema-barrel.mjs` fails the build over (`pnpm lint` runs it).
 *
 * `PgTable` rather than the generic `Table` that `migrations.test.ts` narrows to: it is the same
 * reflection, one class more specific, because `getTableConfig` needs the pg variant to hand back
 * `schema`. See `qualifiedTableNames` for why the schema is wanted at all.
 */
export function barrelTableNames(): string[] {
  return barrelTables()
    .map((table) => getTableName(table))
    .sort()
}

// Widened to `unknown` first: the barrel also exports `pgEnum`s and column helpers, and TypeScript
// will not accept a predicate narrowing to `PgTable` against that literal union of concrete table
// types.
function barrelTables(): PgTable[] {
  return (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
    is(value, PgTable),
  )
}

/**
 * `"public"."documents"` for each barrel table.
 *
 * Schema-qualified for one reason: it states, in the statement itself, that **only the tables this
 * codebase describes are truncated.** pg-boss puts its ~10 tables in the `pgboss` schema
 * (`jobs/boss.ts`) and Drizzle's journal lives in `drizzle`; neither is in the barrel, so neither is
 * reflected — the qualification is belt to that braces, and it also removes any dependence on
 * `search_path`. Better Auth's four tables ARE in `public` and ARE in the barrel (`db/schema/auth.ts`
 * defines them, since ADR-0007 self-hosts it in our Postgres), so they are truncated — exactly as the
 * hand-written list did. There is no long-lived test user to protect: every suite seeds its own via
 * `seedUserWithSpace()`.
 *
 * The names are interpolated rather than bound because an identifier cannot be a bind parameter.
 * They come from Drizzle's compiled schema, not from any caller, and the regex below refuses
 * anything that is not a plain lowercase identifier rather than quoting-and-hoping.
 */
function qualifiedTableNames(): string[] {
  return barrelTables()
    .map((table) => {
      const { schema: pgSchema } = getTableConfig(table)
      return `${quoteIdentifier(pgSchema ?? 'public')}.${quoteIdentifier(getTableName(table))}`
    })
    .sort()
}

function quoteIdentifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`refusing to truncate an unexpected identifier: ${value}`)
  }
  return `"${value}"`
}

/** Reflection is pure and database-free, so it is done once per process rather than per test. */
const truncateTargets = qualifiedTableNames()

/**
 * Truncation, not a transaction-rollback wrapper: `spacesService.ensurePersonalSpace()` opens
 * its own transaction (conventions/code.md §8 — services own transactions), and a rollback
 * wrapper cannot contain that.
 *
 * Raw SQL outside a repository, which conventions/code.md §1 forbids in application code. This
 * is test infrastructure, not application code, and there is no actor to scope it to — the
 * point is to remove *every* space's rows.
 *
 * **`cascade` is now load-bearing, where before it was only prudent.** The old list was ordered
 * child-first by hand and said cascade "makes the order redundant"; a reflected set is ordered
 * alphabetically, which puts `documents` before `things` even though `documents.thing_id`
 * references it (things.md §4 rule 5). `cascade` is what makes any order legal — and it also
 * reaches a table that references one of these and is somehow not in the barrel, which is the one
 * case reflection alone cannot see.
 */
export async function truncateAll(): Promise<void> {
  // D33's rule applied to a cleanup instead of an assertion: truncating nothing and truncating
  // everything both complete silently, and the first one only shows up as an unreproducible flake
  // in whichever test happens to run second. If `is(value, PgTable)` ever stops narrowing — a
  // Drizzle major, a barrel that re-exports through another module — this must fail loudly.
  // Completeness (barrel vs. `information_schema`, both directions) is asserted with teeth in
  // `db/migrations.test.ts`; this is only the floor.
  if (truncateTargets.length === 0) {
    throw new Error(
      'truncateAll: reflected NO tables from db/schema/index.js. That is a broken cleanup, not an ' +
        "empty schema — every test after the first would inherit the previous one's rows.",
    )
  }

  await db.execute(sql.raw(`truncate table ${truncateTargets.join(', ')} restart identity cascade`))
}

/** Call at the top of a `describeDb` block. No shared mutable state between tests (§5). */
export function withCleanDatabase(): void {
  beforeEach(async () => {
    await truncateAll()
  })
}
