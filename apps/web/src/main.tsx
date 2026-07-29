import { registerSW } from 'virtual:pwa-register'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { startOutboxReplay } from '@/lib/outbox-replay'
import { cacheBuster, dehydrateOptions, MAX_AGE, queryCachePersister } from '@/lib/persister'
import { createQueryClient } from '@/lib/query-client'
import { routeTree } from './routeTree.gen'
import './styles.css'

const queryClient = createQueryClient()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('#root is missing from index.html')

/**
 * `PersistQueryClientProvider` rather than `QueryClientProvider`: it restores the IndexedDB cache
 * BEFORE rendering children, which is the ordering the offline path depends on.
 *
 * `routes/_authed.tsx` guards the authed area with `ensureQueryData` for `/me`. If children mounted
 * first and the cache arrived afterwards, that guard would run against an empty cache, fail on the
 * network error while offline, and redirect to the error screen — the restore would land moments too
 * late to matter. See `lib/persister.ts`.
 */
createRoot(rootElement).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryCachePersister,
        maxAge: MAX_AGE,
        buster: cacheBuster,
        dehydrateOptions,
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>
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
