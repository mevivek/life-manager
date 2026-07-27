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
    },
  },
})
