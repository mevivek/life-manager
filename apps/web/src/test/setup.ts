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
  /**
   * And any preference a test wrote — the theme, the feel keys, `numbers` (ADR-0034).
   *
   * jsdom keeps one `localStorage` for the whole file, so a test that sets a preference silently
   * changes what every test after it renders. That is the same order-dependence `resetHandlers`
   * exists to prevent, and it now has real teeth: `feel.numbers` decides whether a number is drawn
   * in full or masked, so a leak turns "shows the number" into a passing test of the wrong thing.
   * `theme.test.ts` and `feel.test.ts` clear it themselves and can keep doing so; this is the floor.
   */
  localStorage.clear()
})

afterAll(() => {
  server.close()
})
