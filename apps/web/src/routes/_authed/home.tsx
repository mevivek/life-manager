import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DocumentList } from '@/features/documents/DocumentList'
import { ExpiringSoon } from '@/features/documents/ExpiringSoon'
import { NotificationsCard } from '@/features/documents/NotificationsCard'
import { useMe } from '@/features/spaces/useMe'
import { endSession } from '@/lib/session'

export const Route = createFileRoute('/_authed/home')({ component: HomePage })

/**
 * The dashboard — the exceptions, not the archive.
 *
 * domains/documents.md §7 asked for "expiring in 30 and 90 days, recently added, documents with no
 * file". This ships **two** sections rather than four, and §7 records why: the two expiry cards
 * duplicated each other (a single upper bound means everything inside 30 days is also inside 90),
 * and "recently added" repeated whatever the others showed because the Documents tab is already the
 * full list. What is left answers one question — *what needs doing* — which is the question the
 * backlog entry that proposed this screen actually posed.
 *
 * It replaced M0's vertical-slice page, which existed to prove the session resolved to an
 * `ActorContext` with exactly one space. That proof now lives in `me.test.ts` and
 * `scripts/verify-deployment.mjs` rather than on the user's home screen — the spaces list and the
 * health readout were scaffolding, and keeping them here would mean showing plumbing to someone who
 * only wants to know when their passport expires.
 */

/** A greeting rather than the app's own name, which the user can already see on their home screen. */
function greeting(now = new Date()): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function HomePage() {
  const me = useMe()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <div className="flex flex-col gap-6">
      {/*
        A screen title, not a page header. The nav links that used to live here moved to the tab
        bar — cramming a title, an email and two buttons into one row was both ugly on a phone and
        the reason there was no persistent navigation.
      */}
      <div className="flex items-baseline justify-between gap-4">
        {/* Just the greeting. An eyebrow above it ("Your documents") read backwards — the label was
            more specific than the heading it labelled — and the app's own name is already on the
            home screen the user tapped to get here. */}
        <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight">{greeting()}</h1>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={async () => {
            // Signs out AND deletes the IndexedDB cache. Since the Query cache is persisted,
            // `queryClient.clear()` alone would leave the previous user's document list on disk for
            // the next person on a shared device. See lib/session.ts.
            await endSession(queryClient)
            await navigate({ to: '/login' })
          }}
        >
          Sign out
        </Button>
      </div>

      {me.isError && <Alert variant="destructive">{me.error.message}</Alert>}

      {/*
        ONE "expiring soon" list, not the separate 30-day and 90-day cards domains/documents.md §7
        originally described.
        
        Two cards were **actively wrong**, not just verbose: `?expiring_before=` is a single
        upper bound, so anything inside 30 days is also inside 90 and appeared in *both* lists. The
        expiry badge already encodes urgency by colour — red past due, amber within 30, pale within
        90 — so one list ordered soonest-first carries the same information without repeating a row.
        §7 records the change.

        No "Add" button either: the tab bar carries it on every screen, which is the point.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Needs attention</CardTitle>
        </CardHeader>
        <CardContent>
          <ExpiringSoon withinDays={90} />
        </CardContent>
      </Card>

      {/* Renders nothing at all when push is unconfigured — it owns its own Card. */}
      <NotificationsCard />

      {/*
        "Recently added" used to sit here and was removed. The Documents tab is already the whole
        list, and on a small archive *everything* is recently added — so it showed the same rows as
        the two sections around it. What is left is the two things that need doing: something is
        expiring, or something has no scan attached. A document can legitimately appear in both,
        because those are two different jobs. domains/documents.md §7 records the change.
      */}
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
