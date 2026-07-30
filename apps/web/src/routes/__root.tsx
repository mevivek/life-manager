import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { OfflineNotice } from '@/components/OfflineNotice'
import { OutboxNotice } from '@/components/OutboxNotice'
import { TabBar } from '@/components/TabBar'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AddSheetProvider } from '@/features/documents/AddSheetProvider'

/**
 * `createRootRouteWithContext` so route `beforeLoad` and loaders can reach the QueryClient
 * without importing a module-level singleton — which would be shared across tests.
 */
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: () => (
    <Shell>
      <Alert variant="notice">That page does not exist.</Alert>
    </Shell>
  ),
})

/**
 * Which routes get app chrome.
 *
 * Login and signup deliberately do **not**. A tab bar on a sign-in screen offers navigation to
 * places that bounce you straight back to it, and it makes the first screen a new user sees look
 * like an app they are already inside. Those screens keep the old centred layout, which is the
 * right shape for a single form.
 */
function useHasChrome(): boolean {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return !['/', '/login', '/signup'].includes(pathname)
}

function Shell({
  children,
  withChrome = false,
}: {
  children: React.ReactNode
  withChrome?: boolean
}) {
  return (
    <div
      className={
        withChrome
          ? // `pb-28` clears the fixed tab bar; without it the last row sits underneath it and
            // looks clipped. The TOP inset lives here while the tab bar owns the BOTTOM one — which
            // is why neither is on `body` any more (see styles.css).
            //
            // `px-gutter` is the design's 22px screen gutter (26px at 430px+), a hair wider than
            // iOS's 16pt so the serif has room to breathe.
            'mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 px-gutter pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-28'
          : 'mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-5 px-gutter py-8'
      }
    >
      {children}
    </div>
  )
}

function RootLayout() {
  const withChrome = useHasChrome()

  /**
   * A sign-in screen gets no provider and no sheet.
   *
   * Early-returning rather than rendering `AddSheetProvider` unconditionally keeps `AddDocumentSheet`
   * — which reads the document mutations, and therefore the session — out of the tree on routes where
   * nobody is signed in yet.
   */
  if (!withChrome) {
    return (
      <Shell withChrome={false}>
        <Outlet />
      </Shell>
    )
  }

  return (
    /**
     * The provider wraps the shell, not just the tab bar, because Add now opens from *inside* the
     * outlet — the Now header and the Documents pill — since the design moved it off the tab bar. See
     * `AddSheetProvider` for why this stopped being a `useState` and a prop.
     */
    <AddSheetProvider>
      <Shell withChrome={true}>
        {/* Above the outlet, so the staleness warning ADR-0013 requires is the first thing on the
            screen rather than something to scroll to. Renders nothing while online. */}
        <OfflineNotice />
        {/* Separate from OfflineNotice: a queue can hold unsent writes, or a conflict needing a
            decision, long after the connection came back. Being online says nothing about it. */}
        <OutboxNotice />
        <Outlet />
      </Shell>
      <TabBar />
    </AddSheetProvider>
  )
}

function RootError({ error }: { error: Error }) {
  return (
    <Shell>
      <Alert>
        <p className="font-medium">Something went wrong.</p>
        {/* This is a single-user private app, so showing the message is a debugging aid rather
            than an information leak. The API already refuses to put internals in a 500 body.
            `.selectable` so it can actually be copied into a bug report. */}
        <p className="selectable mt-1 text-ink-2">{error.message}</p>
      </Alert>
      <Button
        variant="secondary"
        className="self-start"
        // A full reload rather than a router navigation: the error boundary has already caught a
        // render failure, so the safest recovery is to rebuild the tree from scratch.
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
    </Shell>
  )
}
