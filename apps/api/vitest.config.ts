import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    include: ['src/**/*.test.ts'],

    // Forks, not threads: pg and pg-boss both keep process-level state, and a leaked
    // connection in a worker thread is far harder to reason about than in a child process.
    pool: 'forks',
    fileParallelism: true,

    globalSetup: ['./src/test/global-setup.ts'],
    setupFiles: ['./src/test/setup.ts'],

    // Testcontainers pulling postgres:17-alpine on a cold machine takes longer than the
    // 10s default, and a timeout there looks like a broken suite rather than a slow pull.
    hookTimeout: 120_000,
    testTimeout: 30_000,

    /**
     * Fake-but-valid values so `src/env.ts` parses in tests that never touch a database.
     * conventions/testing.md §5: obvious fakes only, never a copied real value.
     *
     * `DATABASE_URL` here is a placeholder. `src/test/setup.ts` overwrites it with the real
     * throwaway database (Testcontainers, or `TEST_DATABASE_URL`) before anything connects.
     */
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      APP_VERSION: '0.0.0-test',
      DATABASE_URL: 'postgresql://not-a-real-host/placeholder',
      DATABASE_URL_UNPOOLED: 'postgresql://not-a-real-host/placeholder',
      BETTER_AUTH_SECRET: 'test-secret-not-a-real-one-0000000000',
      API_BASE_URL: 'http://localhost:8080',
      WEB_ORIGIN: 'http://localhost:5173',

      /**
       * Fake R2 credentials, so the file endpoints exercise the **real** presign path.
       *
       * This works — and is not a fudge — because SigV4 presigning is a purely local computation:
       * no network call, no credential validation against the service. So the tests cover key
       * construction, the signed size/type headers and the whole upload state machine, and the
       * only uncovered step is R2 accepting the PUT, which no test could cover anyway.
       *
       * Obvious fakes (conventions/testing.md §5). Without these the endpoints would answer 503 and
       * every file test would be asserting the unconfigured path instead of the real one.
       */
      R2_ACCOUNT_ID: 'not-a-real-account',
      R2_ACCESS_KEY_ID: 'not-a-real-access-key',
      R2_SECRET_ACCESS_KEY: 'not-a-real-secret-key',
      R2_BUCKET: 'test-bucket',

      // Push stays UNCONFIGURED on purpose: `reminders.test.ts` asserts the not-configured path,
      // which is a real runtime state and the one a deployment hits before VAPID keys are set.
    },
  },
})
