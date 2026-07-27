import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useHealth } from '@/features/health/useHealth'
import { useMe } from '@/features/spaces/useMe'
import { signOut } from '@/lib/auth-client'

export const Route = createFileRoute('/_authed/home')({ component: HomePage })

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The M0 vertical slice, and the thing the acceptance criterion is read off.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * roadmap.md M0: "done when you can sign up on your phone, and the API proves the session
 * resolves to an ActorContext with exactly one space."
 *
 * The spaces list below is rendered from `GET /api/v1/me`, which the API builds from
 * `request.actor` — itself built from a live `space_members` query on every request. So seeing
 * one row here, `personal` / `owner`, IS the API proving it. There is no client-side state
 * involved and nothing cached across a sign-out.
 */
function HomePage() {
  const me = useMe()
  const health = useHealth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">life-manager</h1>
          <p className="text-sm text-muted-foreground">{me.data?.email ?? '…'}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await signOut()
            // Drop every cached server response. Leaving `/me` in the cache would show the
            // previous user's email to the next one on a shared device.
            queryClient.clear()
            await navigate({ to: '/login' })
          }}
        >
          Sign out
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your spaces</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {me.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
          {me.isError && <Alert variant="destructive">{me.error.message}</Alert>}
          {me.data?.spaces.map((space) => (
            <div
              key={space.space_id}
              className="flex items-center justify-between rounded-md border border-border px-3 py-2"
            >
              <span className="text-sm font-medium">{space.name}</span>
              <span className="text-xs text-muted-foreground">
                {space.kind} · {space.role}
              </span>
            </div>
          ))}
          {me.data?.spaces.length === 0 && (
            <Alert variant="destructive">
              No spaces. That should be impossible — every account gets one at signup (ADR-0006).
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>API</CardTitle>
        </CardHeader>
        <CardContent>
          {health.isError ? (
            <Alert variant="destructive">Cannot reach the API.</Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {health.data === undefined
                ? 'Checking…'
                : `${health.data.status} · v${health.data.version} · up ${health.data.uptime_seconds}s`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
