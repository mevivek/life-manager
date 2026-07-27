import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach } from 'vitest'
import { server } from './msw'

/**
 * `server.listen()` at MODULE TOP LEVEL, not inside `beforeAll` — and that is load-bearing.
 *
 * Setup files are evaluated before the test file's module graph, whereas a `beforeAll` runs
 * after it. Better Auth's client captures `globalThis.fetch` when `createAuthClient()` is called
 * at module load, so a `beforeAll` patch arrives too late: MSW never sees the request, it escapes
 * to the real network, and the test fails with `ECONNREFUSED` naming the wrong problem entirely.
 *
 * `onUnhandledRequest: 'error'` rather than 'warn': an unhandled request means the test is about
 * to hit the network, which conventions/testing.md §5 forbids outright. Fail, do not log.
 */
server.listen({ onUnhandledRequest: 'error' })

afterEach(() => {
  cleanup()
  // Undoes any per-test `server.use(...)` override, so tests stay order-independent (§5).
  server.resetHandlers()
})

afterAll(() => {
  server.close()
})
