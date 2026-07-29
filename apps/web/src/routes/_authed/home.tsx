import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { DocumentListSkeleton } from '@/components/ui/skeleton'
import { DocumentRow } from '@/features/documents/DocumentRow'
import { ExpiryGlyph, formatDate, NEEDS_YOU_DAYS } from '@/features/documents/ExpiryStatus'
import { Horizon } from '@/features/documents/Horizon'
import { NotificationsCard } from '@/features/documents/NotificationsCard'
import { type Ledger, toLedger, useLedger } from '@/features/documents/useLedger'
import { endSession } from '@/lib/session'
import { useTheme } from '@/lib/useTheme'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/home')({ component: NowPage })

/**
 * **Now** — the screen the whole design turns on. ADR-0024 §1.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This collapses "what needs doing" and "what's coming" into one screen, on purpose.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The previous dashboard had two cards — *Needs attention* (90 days) and *Missing a file* — and its
 * hardest state was the **good** one: with nothing expiring it said "Nothing expiring in the next 90
 * days. That is the point." To someone who opens this app twice a month that is worthless. It answers
 * a question they did not ask and withholds the one they did.
 *
 * So Now always shows the **forward timeline** as well, however far away the next date is. The answer
 * is never *nothing*; it is "nothing until 4 March". That single change is what makes an all-clear
 * screen worth opening, and it is why `Horizon` has no meaningful empty state — see its own note.
 *
 * ── The 45-day boundary replaces 30 and 90 ──
 *
 * One boundary, one question. The old badge had tiers at 30 and 90 because the dashboard queried
 * `?expiring_before=` twice, and a single upper bound means everything inside 30 days is also inside
 * 90 — so the two cards showed the same rows (documents.md §7 records that bug). `NEEDS_YOU_DAYS` is
 * now the only threshold in the client, and it decides a glyph and a sentence. **It is not a business
 * rule**: reminders fire at 90/30/7 server-side, per `DEFAULT_LEAD_DAYS` (invariant 5).
 *
 * ── One request ──
 *
 * Everything below comes from `useLedger()`. See that module for why a client-side partition is right
 * here and wrong almost everywhere else in the app.
 */

function NowPage() {
  const documents = useLedger()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { resolved, toggle } = useTheme()

  return (
    <div>
      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         Sign out and the theme toggle live on this row, which the comp did not draw.
        ═══════════════════════════════════════════════════════════════════════════════════

        The design has no settings surface at all — its theme switch was part of the prototype's
        harness, not of the app. But sign-out has to be reachable (and `endSession` purges the
        persisted cache, so it is load-bearing rather than a nicety), and an app with two themes needs
        a way to override the system.

        Putting both here as quiet `--ink-3` text beside the eyebrow is the smallest deviation that
        keeps them reachable: they share a line with the date rather than competing with the serif
        headline, which is what the design's hierarchy requires. A settings screen is the right home
        for them once there are more than two — noted in ADR-0024 §10.
      */}
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>
          <time dateTime={todayIso()}>{todayLabel()}</time>
        </Eyebrow>
        <div className="-mr-3 flex shrink-0 items-baseline">
          <Button
            variant="quiet"
            size="sm"
            className="text-meta text-ink-3"
            onClick={toggle}
            // The control's job is switching, so its accessible name is the destination. "Light"
            // alone reads as a label for what you are already looking at.
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
          >
            {resolved === 'dark' ? 'Light' : 'Dark'}
          </Button>
          <Button
            variant="quiet"
            size="sm"
            className="text-meta text-ink-3"
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
      </div>

      {documents.isPending ? (
        <div className="pt-6">
          <DocumentListSkeleton count={3} />
        </div>
      ) : documents.isError ? (
        <div className="pt-5">
          <Card tone="late" className="p-4">
            <p className="text-row font-medium">Couldn’t load your documents</p>
            <p className="mt-1 text-body leading-relaxed text-ink-2">
              {/* The real message rather than a generic one: this is a single-user private app, and
                  the API already refuses to put internals in an error body. */}
              {documents.error.message}
            </p>
            <p className="mt-1 text-meta text-ink-3">Your data is safe.</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void documents.refetch()}
            >
              Try again
            </Button>
          </Card>
        </div>
      ) : (
        <NowBody ledger={toLedger(documents.data.data, documents.data.next_cursor)} />
      )}
    </div>
  )
}

function NowBody({ ledger }: { ledger: Ledger }) {
  const { needsYou, horizon, withoutScan, datedCount, loadedCount, complete } = ledger

  if (loadedCount === 0) return <ZeroState />

  /** The soonest dated document, for the all-clear headline's "the next date is…". */
  const next = needsYou[0] ?? horizon[0] ?? null

  /**
   * The soonest **still-future** date, which is what the push ask may name.
   *
   * Not `next`. `needsYou` is ordered soonest-first and *includes documents that already expired*, so
   * `next` is frequently a lapsed one — and the ask then read: *"Your first aid certificate expires 14
   * June 2026. We can send a notification 90, 30 and 7 days before."* about a date six weeks in the
   * past. Offering to warn someone ahead of an event that has happened is worse than not asking:
   * it is the app demonstrating it cannot read a calendar, at the exact moment it asks for a
   * permission.
   *
   * Caught by screenshotting the Now screen, not by a test — every individual piece was correct.
   */
  const nextFuture =
    [...needsYou, ...horizon].find((row) => row.expiry.days !== null && row.expiry.days >= 0) ??
    null

  return (
    <>
      <h1 className="mt-2.5 font-serif text-display font-normal leading-[1.15] tracking-tight-display">
        {needsYou.length === 0
          ? 'Nothing needs you today.'
          : needsYou.length === 1
            ? 'One thing needs you.'
            : `${needsYou.length} things need you.`}
      </h1>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
        {needsYou.length > 0
          ? 'Everything else is in order.'
          : next !== null && next.document.expires_on !== null
            ? // The all-clear that still answers the question. "Nothing until 4 March" beats
              // "nothing", which is the entire argument for this screen.
              `The next date is ${formatDate(next.document.expires_on)} — ${next.expiry.label.replace('in ', '')} away.`
            : 'No document here has an expiry date.'}
      </p>

      {needsYou.length > 0 && (
        <section className="pt-5">
          <div className="pb-2.5">
            <Eyebrow>Needs you</Eyebrow>
          </div>
          {/*
            One bordered card with hairline-divided rows, rather than a stack of separate cards. The
            group is the unit — these rows are one answer to one question, and boxing each of them
            individually would make four problems look like four sections.
          */}
          <Card className="overflow-hidden p-0">
            {needsYou.map(({ document, expiry }, index) => (
              <DocumentRow
                key={document.id}
                document={document}
                expiry={expiry}
                // The rule goes above every row but the first — the card's own border is that one's
                // top edge. The chevron goes on all of them.
                divided={index > 0}
                chevron
              />
            ))}
          </Card>
        </section>
      )}

      {needsYou.length === 0 && datedCount > 0 && (
        <section className="pt-5">
          <Card tone="ok" className="flex gap-3.5 p-4">
            <span className="flex w-3.5 shrink-0 justify-center pt-[3px]">
              {/* The ring, unpulsed, in the ok tone: the ladder's "today" glyph reused to say
                  "checked". The pulse means one thing only, so it is switched off here. */}
              <ExpiryGlyph state="today" className="text-status-ok [animation:none]" />
            </span>
            <div>
              <p className="text-row font-medium leading-snug">
                Nothing expires in the next {NEEDS_YOU_DAYS} days
              </p>
              <p className="mt-1 text-body leading-relaxed text-ink-2">
                Every document with a date is checked once a day. We’d have told you.
              </p>
            </div>
          </Card>
        </section>
      )}

      <div className="pt-4">
        <NotificationsCard
          expiresOn={nextFuture?.document.expires_on ?? null}
          title={nextFuture?.document.title ?? null}
        />
      </div>

      <Horizon rows={horizon} datedTotal={datedCount} complete={complete} />

      {withoutScan.length > 0 && (
        <div className="pt-2">
          {/*
            A nudge, not a warning: `--sunken` with a `--rule` hairline, the quietest panel in the
            system. It opens the archive already filtered to `has_file=false`, so this is a shortcut
            rather than a scolding.
          */}
          <Link
            to="/documents"
            search={{ scan: 'no' }}
            className="flex min-h-[3.75rem] items-center gap-3.5 rounded-3 border border-rule bg-sunken px-4 py-3.5 transition-colors active:bg-rule/40 hover:bg-rule/40"
          >
            <span
              aria-hidden="true"
              className="h-[19px] w-[15px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-ink-3"
            />
            <span className="flex-1">
              <span className="block text-body font-medium leading-snug">
                {withoutScan.length}
                {complete ? '' : '+'} {withoutScan.length === 1 ? 'document has' : 'documents have'}{' '}
                no scan
              </span>
              <span className="mt-px block text-meta text-ink-3">
                Worth a photo next time you have them out
              </span>
            </span>
            <span
              aria-hidden="true"
              className="h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
            />
          </Link>
        </div>
      )}

      {/*
        The ledger footer. Every number is derived from what was actually loaded, and `complete` is
        what keeps it honest — see `useLedger`. The API has no count endpoint, so an exact total is
        only claimable when the whole archive fitted in one page.
      */}
      <p className="mt-6 mb-2 border-t border-rule pt-3 text-meta leading-loose text-ink-3 [text-wrap:pretty]">
        {complete ? loadedCount : `${loadedCount}+`} {loadedCount === 1 ? 'document' : 'documents'}{' '}
        · {datedCount} with a date we watch · {withoutScan.length} without a scan.
      </p>
    </>
  )
}

/**
 * The zero state. ADR-0024 §7: never an illustration — a sentence in the serif, one instruction, one
 * control.
 *
 * The comp put a live input here, making this the only empty state in the app with a field inline.
 * This routes to `/documents/new` instead, and the difference is deliberate: a second create form
 * would be a second thing to keep in step with `documentCreateSchema`, and the tap it saves is paid
 * exactly once in the app's lifetime — on the first document ever added. One create path is worth
 * more than one tap.
 */
function ZeroState() {
  return (
    <>
      <h1 className="mt-2.5 font-serif text-display font-normal leading-[1.15] tracking-tight-display">
        Nothing in here yet.
      </h1>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
        One field, one tap. You can fill in the rest of your life later.
      </p>

      <Card dashed className="mt-6 p-5">
        <Eyebrow>Start here</Eyebrow>
        <p className="mt-2.5 font-serif text-[1.25rem] leading-snug">
          Name one thing. That’s the whole first step.
        </p>
        <Link to="/documents/new" className={cn(buttonVariants({ size: 'lg' }), 'mt-3.5 w-full')}>
          Add the first one
        </Link>
        <p className="mt-3 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          No type, no date, no scan needed. You can add those any time — or never.
        </p>
      </Card>

      <p className="mt-5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        Three good first documents: your passport, your car insurance, the boiler warranty. All
        three have dates that matter.
      </p>
    </>
  )
}

/** `Wednesday 29 July` — the date, spelled the way a person would say it. */
function todayLabel(now = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now)
}

/** The machine-readable twin for `<time datetime>`, in LOCAL date parts to match the label above. */
function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
