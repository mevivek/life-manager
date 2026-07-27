/**
 * Gets ONE real Postgres server for the whole run and hands its URL to the workers, which each
 * carve out their own database from it and migrate that (see `setup.ts`).
 * conventions/testing.md §1: API integration tests run against a real database, because most of
 * what can go wrong here — the space filter, cascades, partial unique indexes — is database
 * behaviour, and a mocked database tests the mock.
 *
 * Two paths, in priority order (ADR-0018):
 *
 *   1. `TEST_DATABASE_URL` is set  → use it. No Docker required. Its tables are TRUNCATED
 *      between tests, so it must be a throwaway.
 *   2. otherwise                  → start a `postgres:17-alpine` Testcontainer. This is the
 *      default: no credential to manage, nothing outbound, torn down after the run.
 *
 * If neither is available — no `TEST_DATABASE_URL` and no Docker daemon — the run does NOT
 * fail. Database-backed suites skip with a message telling you which of the two to set up, and
 * every pure unit and HTTP test still runs. A hard failure here would mean a fresh clone
 * cannot get a green `pnpm test` until Docker is installed, which is how test suites start
 * getting skipped wholesale.
 */

declare module 'vitest' {
  interface ProvidedContext {
    /** `null` when no database was available. See `src/test/db.ts`. */
    databaseUrl: string | null
  }
}

const IMAGE = 'postgres:17-alpine'

/**
 * Typed structurally rather than importing Vitest's own context type: that type has been
 * renamed twice (`GlobalSetupContext` is gone in Vitest 4) and `provide` is all we use.
 */
type GlobalSetup = {
  provide: <K extends 'databaseUrl'>(key: K, value: string | null) => void
}

export default async function setup({ provide }: GlobalSetup) {
  const override = process.env.TEST_DATABASE_URL
  if (override !== undefined && override !== '') {
    provide('databaseUrl', override)
    console.info('[test] using TEST_DATABASE_URL')
    return
  }

  let container: { stop: () => Promise<unknown> } | undefined
  try {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
    const started = await new PostgreSqlContainer(IMAGE).start()
    container = started
    provide('databaseUrl', started.getConnectionUri())
    console.info(`[test] started ${IMAGE} via Testcontainers`)
  } catch (error) {
    await container?.stop().catch(() => undefined)
    provide('databaseUrl', null)

    // Loud, specific, and actionable. Never silent — conventions/code.md §6.
    console.warn(
      [
        '',
        '  ┌─────────────────────────────────────────────────────────────────────────┐',
        '  │  No test database. Database-backed suites will SKIP, not fail.           │',
        '  │                                                                         │',
        '  │  Fix it either way:                                                     │',
        '  │    • start Docker Desktop  (Testcontainers then works with no config)   │',
        '  │    • or set TEST_DATABASE_URL in apps/api/.env to a throwaway Postgres  │',
        '  │      — its tables are TRUNCATED between tests                           │',
        '  └─────────────────────────────────────────────────────────────────────────┘',
        `  reason: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
        '',
      ].join('\n'),
    )
    return
  }

  return async () => {
    await container?.stop()
  }
}
