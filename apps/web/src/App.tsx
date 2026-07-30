import type { QueryClient } from '@tanstack/react-query'
import { useIsRestoring } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import type { ReactNode } from 'react'
import { cacheBuster, dehydrateOptions, MAX_AGE, queryCachePersister } from '@/lib/persister'
import { FeelProvider } from '@/lib/useFeel'

/**
 * The provider tree, split out of `main.tsx` so that a test can mount the REAL one.
 *
 * `main.tsx` keeps only what cannot be tested and must not run twice — `createRoot`, `registerSW`,
 * `startOutboxReplay`. Everything about *ordering* lives here, because ordering is the part that had
 * a bug in it and a test that reimplements the ordering it is checking protects nothing.
 */

/**
 * ══════════════════════════════════════════════════════════════════════════════════════
 *  Holds its children back until the persisted cache has actually been restored.
 *  Removing this gate does not fail a typecheck. It fails the app, on a phone.
 * ══════════════════════════════════════════════════════════════════════════════════════
 *
 * `PersistQueryClientProvider` does **not** restore before rendering its children, which is what
 * `main.tsx` used to claim it did. Read its source: it renders children immediately inside an
 * `IsRestoringProvider` and starts the restore in a `useEffect`. `RouterProvider` was that child, and
 * React runs a child's effects before its parent's — so the router began loading FIRST and
 * `routes/_authed.tsx` ran `ensureQueryData(['me'])` against an empty cache on every launch.
 *
 * Two measured consequences, neither of which any test covered at the time:
 *
 *  1. **Online:** the guard always went to the network, even with a valid in-date `me` on disk, so
 *     every cold launch waited on the API's cold start — measured at 8825ms against 22ms warm —
 *     behind a completely blank screen.
 *  2. **Offline:** worse than slow. Queries keep `networkMode: 'online'` (see `lib/query-client.ts`),
 *     which *pauses* a fetch rather than failing it, so `beforeLoad` awaited a promise that never
 *     settled. Not a slow launch: a permanently blank one, instead of the cached archive ADR-0013
 *     promises.
 *
 * `useIsRestoring()` is the signal the provider does give us, so gating on it makes the ordering real
 * instead of assumed. Rendering `null` for that one frame costs nothing visible — it is a local
 * IndexedDB read, and `index.html` has already painted the paper background.
 *
 * `lib/startup.test.tsx` mounts this component and pins both consequences.
 */
function RestoreGate({ children }: { children: ReactNode }) {
  const isRestoring = useIsRestoring()
  if (isRestoring) return null
  return <>{children}</>
}

export function App({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryCachePersister,
        maxAge: MAX_AGE,
        buster: cacheBuster,
        dehydrateOptions,
      }}
    >
      <RestoreGate>
        {/*
          Inside the persist provider, outside the router — the position this arrived in from the Feel
          work, kept verbatim in spirit: the voice register is read as a *value* by route components
          (`home.tsx`, `login.tsx`, `you.tsx`, `CaptureSheet.tsx`), so the context has to sit above
          them, and above the router is the shallowest place that covers every screen.

          It lives HERE rather than in `main.tsx` for the same reason the persist provider does: a tree
          assembled in `main.tsx` is a tree no test can mount, and `useFeel` deliberately falls back to
          `DEFAULT_FEEL` outside a provider — so a missing provider does not throw, it quietly renders
          the default voice. That is the failure mode a test would never notice.

          Below `RestoreGate` costs nothing: it reads `localStorage`, not the query cache, and density
          and face are stamped on `<html>` by the pre-paint bootstrap in `index.html` rather than by
          this provider.
        */}
        <FeelProvider>{children}</FeelProvider>
      </RestoreGate>
    </PersistQueryClientProvider>
  )
}
