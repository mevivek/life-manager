import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Alert } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DocumentList } from '@/features/documents/DocumentList'
import { ExpiringSoon } from '@/features/documents/ExpiringSoon'
import { NotificationsCard } from '@/features/documents/NotificationsCard'
import { useMe } from '@/features/spaces/useMe'
import { signOut } from '@/lib/auth-client'

export const Route = createFileRoute('/_authed/home')({ component: HomePage })

/**
 * The dashboard. domains/documents.md §7: "expiring in 30 and 90 days, recently added, documents
 * with no file."
 *
 * This replaced M0's vertical-slice page, which existed to prove the session resolved to an
 * `ActorContext` with exactly one space. That proof now lives in `me.test.ts` and
 * `scripts/verify-deployment.mjs` rather than on the user's home screen — the spaces list and the
 * health readout were scaffolding, and keeping them here would mean showing plumbing to someone who
 * only wants to know when their passport expires.
 */
function HomePage() {
  const me = useMe()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">life-manager</h1>
          <p className="truncate text-sm text-muted-foreground">{me.data?.email ?? '…'}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link to="/documents" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            All documents
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await signOut()
              // Drop every cached server response. Leaving `/me` or a document list in the cache
              // would show the previous user's data to the next one on a shared device.
              queryClient.clear()
              await navigate({ to: '/login' })
            }}
          >
            Sign out
          </Button>
        </div>
      </div>

      {me.isError && <Alert variant="destructive">{me.error.message}</Alert>}

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Expiring in 30 days</CardTitle>
          <Link to="/documents/new" className={buttonVariants({ size: 'sm' })}>
            Add
          </Link>
        </CardHeader>
        <CardContent>
          <ExpiringSoon withinDays={30} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Expiring in 90 days</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpiringSoon withinDays={90} />
        </CardContent>
      </Card>

      {/* Renders nothing at all when push is unconfigured — it owns its own Card. */}
      <NotificationsCard />

      <Card>
        <CardHeader>
          <CardTitle>Recently added</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentList
            baseQuery={{ sort: 'created_at', order: 'desc', limit: 5 }}
            showFilters={false}
            emptyMessage="No documents yet. Start with something that expires — a passport or a licence."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Missing a file</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentList
            baseQuery={{ has_file: false, limit: 5 }}
            showFilters={false}
            emptyMessage="Every document has a file attached."
          />
        </CardContent>
      </Card>
    </div>
  )
}
