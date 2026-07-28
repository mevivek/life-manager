import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, useRouterState } from '@tanstack/react-router'
import { TabBar } from '@/components/TabBar'
import { Alert } from '@/components/ui/alert'

/**
 * `createRootRouteWithContext` so route `beforeLoad` and loaders can reach the QueryClient
 * without importing a module-level singleton — which would be shared across tests.
 */
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: () => (
    <Shell>
      <Alert>That page does not exist.</Alert>
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
          ? // `pb-24` clears the fixed tab bar (h-16 plus breathing room); without it the last card
            // sits underneath it and looks clipped. The TOP inset lives here while the tab bar owns
            // the BOTTOM one — which is why neither is on `body` any more (see styles.css).
            'mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-24'
          : 'mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 px-4 py-8'
      }
    >
      {children}
    </div>
  )
}

function RootLayout() {
  const withChrome = useHasChrome()

  return (
    <>
      <Shell withChrome={withChrome}>
        <Outlet />
      </Shell>
      {withChrome && <TabBar />}
    </>
  )
}

function RootError({ error }: { error: Error }) {
  return (
    <Shell>
      <Alert variant="destructive">
        <p className="font-medium">Something went wrong.</p>
        {/* This is a single-user private app, so showing the message is a debugging aid rather
            than an information leak. The API already refuses to put internals in a 500 body.
            `.selectable` so it can actually be copied into a bug report. */}
        <p className="selectable mt-1 opacity-80">{error.message}</p>
      </Alert>
    </Shell>
  )
}
