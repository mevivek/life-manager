import { registerSW } from 'virtual:pwa-register'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ScreenSkeleton } from '@/components/ui/skeleton'
import { startOutboxReplay } from '@/lib/outbox-replay'
import { createQueryClient } from '@/lib/query-client'
import { App } from './App'
import { routeTree } from './routeTree.gen'
import './styles.css'

/**
 * Process entry point, and deliberately thin.
 *
 * The provider tree lives in `App.tsx` rather than here, because the ordering inside it is
 * load-bearing (see `RestoreGate`) and this file cannot be mounted by a test — `createRoot`,
 * `registerSW` and `startOutboxReplay` are all one-per-page side effects.
 */

const queryClient = createQueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',

  /**
   * What to draw while a route guard is still resolving, and how soon.
   *
   * Without these the router renders NOTHING while `routes/_authed.tsx` waits on `/api/v1/me`, and
   * that wait is not short: the API is scale-to-zero, and a cold instance was measured answering
   * `/health` — which does not even touch Postgres — in 8825ms against 22ms warm. The result was a
   * blank page for the better part of ten seconds on the first launch of the day.
   *
   * 300ms rather than the 1000ms default: past about a third of a second the screen has to admit it
   * is working. `defaultPendingMinMs` keeps its own 500ms floor, so the skeleton cannot strobe when
   * the guard resolves just after the threshold.
   */
  defaultPendingComponent: ScreenSkeleton,
  defaultPendingMs: 300,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('#root is missing from index.html')

createRoot(rootElement).render(
  <StrictMode>
    <App queryClient={queryClient}>
      <RouterProvider router={router} />
    </App>
  </StrictMode>,
)

// `autoUpdate`: a new deploy takes effect on the next navigation rather than prompting. For a
// single-user app an update prompt is pure friction.
registerSW({ immediate: true })

/**
 * Drains the offline write queue when the network returns (ADR-0024).
 *
 * Started here rather than in a component effect so it survives every navigation and is not tied to
 * a mounted tree — a queued write must replay even if the user is sitting on a screen that knows
 * nothing about documents. The returned unsubscribe is dropped on purpose: this lives as long as the
 * page does.
 */
startOutboxReplay(queryClient)
