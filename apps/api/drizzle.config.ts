import { existsSync } from 'node:fs'
import { defineConfig } from 'drizzle-kit'

/**
 * drizzle-kit's config. Runs in the CLI's process, not the API's.
 *
 * **The one deliberate exception to "only src/env.ts reads process.env"**
 * (conventions/code.md §10 requires this comment). Importing `env.ts` here would demand every
 * runtime variable — `BETTER_AUTH_SECRET`, `WEB_ORIGIN` — just to generate a migration file,
 * and `drizzle-kit generate` needs no database at all. drizzle-kit also stopped loading `.env`
 * itself, so Node loads it.
 */
if (existsSync('.env')) process.loadEnvFile('.env')

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  casing: 'snake_case',
  dbCredentials: {
    // The DIRECT endpoint. DDL takes locks that do not belong in a transaction-pooled
    // session, and `drizzle-kit push` diffing through PgBouncer is a bad time.
    url: process.env.DATABASE_URL_UNPOOLED ?? '',
  },
  // Ask before anything destructive. Pre-v1 the dev database may be reset (ADR-0011), but
  // "may be reset" is a decision the human makes, not one drizzle-kit makes for them.
  strict: true,
  verbose: true,
  // pg-boss keeps its tables in its own schema (ADR-0012). Without this, `push` would see
  // them as drift and offer to drop the job queue.
  schemaFilter: ['public'],
})
