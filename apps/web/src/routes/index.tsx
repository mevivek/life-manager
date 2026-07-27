import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/` has no content of its own at M0 — it just decides where you belong. Redirecting rather
 * than rendering means the authed home lives at exactly one URL.
 */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/home' })
  },
})
