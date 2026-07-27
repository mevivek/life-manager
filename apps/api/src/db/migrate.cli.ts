import { env } from '../env.js'
import { logger } from '../lib/logger.js'
import { migrate } from './migrate.js'

/**
 * `pnpm --filter api db:migrate`, and `fly.toml`'s `release_command`.
 *
 * A separate entry point from `migrate.ts` so that importing `migrate()` — which the test
 * harness does on every run — can never accidentally apply migrations to whatever
 * `DATABASE_URL_UNPOOLED` happens to point at.
 */
logger.info('applying migrations')
await migrate(env.DATABASE_URL_UNPOOLED)
logger.info('migrations applied')
