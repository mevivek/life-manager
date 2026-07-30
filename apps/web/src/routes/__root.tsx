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
          ? /*
             * The bottom padding clears the fixed tab bar, and it is written as the SAME EXPRESSION
             * the bar's own height is — deliberately, because it used to be a flat `pb-28` (112px).
             *
             * ═══════════════════════════════════════════════════════════════════════════════
             *  A constant cannot clear a bar whose height depends on the device.
             * ═══════════════════════════════════════════════════════════════════════════════
             *
             * The bar is `60px + max(env(safe-area-inset-bottom), 0.75rem)`: 94px on a
             * home-indicator iPhone, 72px on a home-button one or a desktop. Against a flat 112px
             * that left **17px of dead paper on the phone and 40px on everything else**, always
             * above the bar, and it was worst exactly where it shows — a screen whose content ends
             * early and pushes its footer down with `mt-auto`. That reads as a gap around the tab
             * bar, and it was reported as one from a real phone.
             *
             * Now it is the bar's height plus one `0.5rem` of breathing room, so the gap is 8px on
             * every device instead of 17 or 40. **If you change the bar's geometry, change this too**
             * — `TabBar.test.tsx` fails if the two stop agreeing, which is the only reason a reader
             * can trust the duplication.
             *
             * The TOP inset lives here while the tab bar owns the BOTTOM one — which is why neither
             * is on `body` any more (see styles.css).
             *
             * `px-gutter` is the design's 22px screen gutter (26px at 430px+), a hair wider than
             * iOS's 16pt so the serif has room to breathe.
             */
            'mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-stack px-gutter pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-[calc(max(env(safe-area-inset-bottom),0.75rem)+4.25rem)]'
          : 'mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-stack px-gutter py-8'
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
