import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-4 py-8">
      {children}
    </div>
  )
}

function RootLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  )
}

function RootError({ error }: { error: Error }) {
  return (
    <Shell>
      <Alert variant="destructive">
        <p className="font-medium">Something went wrong.</p>
        {/* This is a single-user private app, so showing the message is a debugging aid rather
            than an information leak. The API already refuses to put internals in a 500 body. */}
        <p className="mt-1 opacity-80">{error.message}</p>
      </Alert>
    </Shell>
  )
}
