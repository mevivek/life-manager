import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { toLedger, useLedger } from '@/features/documents/useLedger'
import { api } from '@/lib/api'
import { endSession } from '@/lib/session'
import { useTheme } from '@/lib/useTheme'

export const Route = createFileRoute('/_authed/you')({ component: YouPage })

/**
 * **You** — the third tab, and the app's first settings surface.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why this exists, and what it is deliberately NOT
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The design revision replaces the Add tab with this one. Before it, the app had nowhere to put an
 * account, a sign-out or a theme switch, so those two controls were squatting as quiet `--ink-3` text
 * in the Now screen's header — recorded in ADR-0025 §10 as a deviation to undo "once there are more
 * than two". This is that undoing.
 *
 * ── Every row here is either a fact or an honest "not yet" ──
 *
 * The comp draws four rows for features that do not exist: *Change password*, *Export — download
 * everything as a zip*, *Deleted items — recoverable for 30 days*, and *Delete my account and
 * everything in it*, the last described as "Immediate, and we mean it."
 *
 * **They are drawn, because the design was approved as a design. They do not claim to work.** A row
 * that says "Recoverable for 30 days" when soft-delete sets `deleted_at` and *no restore endpoint or
 * purge job exists* is not a placeholder, it is a false promise about the user's own data — and the
 * one person who would act on it is the person reading it. So the unbuilt ones carry `Not yet` and say
 * what is true today. When the endpoint lands, the marker comes off.
 *
 * ── Two sentences from the comp are rewritten, not ported ──
 *
 * It says identifiers are "kept in full and **encrypted at rest**". They are kept in full — that was
 * an explicit product decision — but they are **not encrypted**: invariant 7 and ADR-0009 keep
 * application-level encryption for the vault alone. Saying otherwise would be the app lying to its
 * only user about how their Aadhaar number is stored.
 */

function YouPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { resolved, toggle } = useTheme()

  const me = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60 * 1000 })

  /**
   * Counts come from the ledger the Now screen and the tab badge already fetched — same query key, so
   * this screen adds no request. `complete` is what keeps the numbers honest: a capped page makes
   * every count a floor, and a floor rendered as a total is the `file_count` bug (D33) again in a
   * different costume.
   */
  const documents = useLedger()
  const ledger =
    documents.data === undefined ? null : toLedger(documents.data.data, documents.data.next_cursor)
  const approx = ledger !== null && !ledger.complete ? '+' : ''

  const space = me.data?.spaces[0] ?? null

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mt-2.5 font-serif text-title font-normal leading-tight">You</h1>

      {/* ── Account ── */}
      <Card className="mt-4 p-4">
        <Eyebrow>Account</Eyebrow>
        <p className="mt-2.5 font-serif text-serif-row leading-snug">
          {me.isPending ? '…' : (me.data?.email ?? 'Not signed in')}
        </p>
        <p className="mt-1 text-meta text-ink-3 [text-wrap:pretty]">
          {space === null
            ? 'Email and password.'
            : // The space is the ownership unit (invariant 2), so naming it here is what makes
              // "family sharing later" a believable sentence rather than a roadmap item.
              `Email and password · ${space.name} · ${space.role}`}
        </p>
        <div className="mt-3.5 flex flex-wrap gap-2">
          {/* Disabled, not hidden and not enabled-but-inert. `disabled` puts it in the accessibility
              tree as unavailable, which is the truth; an enabled button that does nothing on tap is
              the failure mode this codebase has already shipped twice in visual form. */}
          <Button variant="secondary" size="sm" disabled>
            Change password
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              // Signs out AND deletes the IndexedDB cache. `queryClient.clear()` alone would leave
              // the previous user's document list on disk for the next person on a shared device.
              // See lib/session.ts.
              await endSession(queryClient)
              await navigate({ to: '/login' })
            }}
          >
            Sign out
          </Button>
        </div>
        <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          No password change yet — signing out and back in is the only credential flow that exists.
        </p>
      </Card>

      {/* ── What we hold ── */}
      <section className="mt-5">
        <Eyebrow>What we hold</Eyebrow>
        <dl className="mt-1">
          <Stat
            term="Documents"
            numeric
            value={ledger === null ? '—' : `${ledger.loadedCount}${approx}`}
          />
          <Stat
            term="With an expiry we watch"
            numeric
            value={ledger === null ? '—' : `${ledger.datedCount}${approx}`}
          />
          <Stat
            term="Without a scan"
            numeric
            value={ledger === null ? '—' : `${ledger.withoutScan.length}${approx}`}
          />
        </dl>
      </section>

      {/* ── Reminders ── */}
      <PushStatus />

      {/* ── Numbers ── */}
      <Card tone="sunken" className="mt-5 p-4">
        <p className="text-row font-medium leading-snug">
          Numbers are stored, and hidden by default
        </p>
        <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
          Passport, Aadhaar, licence and policy numbers are kept in full, because a number you can’t
          read is a number you’ll go and dig the original out for. On a document you see the last
          four until you tap Reveal.
        </p>
        {/*
          The comp says "kept in full and **encrypted at rest**". They are kept in full — ADR-0026 —
          but nothing here is encrypted: invariant 7 and ADR-0009 reserve application-level encryption
          for the vault. This paragraph is that sentence made true, and it is not a footnote: it is the
          only place the app tells its user how their Aadhaar number is actually held, so stating the
          limitation is what makes the sentence above it worth believing.
        */}
        <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          They are not encrypted — the database holds them as text, like every other field. Hiding
          them is about shoulders near your screen, not about the server.
        </p>
      </Card>

      {/* ── App ── */}
      <section className="mt-5">
        <Eyebrow>App</Eyebrow>
        <dl className="mt-1">
          <Stat term="Sharing" value="Single user" note="Family sharing later" />
          <Stat
            term="Theme"
            value={resolved === 'dark' ? 'Dark' : 'Light'}
            action={
              <Button
                variant="quiet"
                size="sm"
                className="text-meta text-ink-2"
                onClick={toggle}
                // The control's job is switching, so its accessible name is the destination. "Light"
                // alone reads as a label for what you are already looking at.
                aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
              >
                {resolved === 'dark' ? 'Use light' : 'Use dark'}
              </Button>
            }
          />
          <Stat
            term="Deleted items"
            value="Gone from every list"
            /*
              NOT "recoverable for 30 days". Delete sets `deleted_at` and every query filters it out,
              but there is no restore endpoint and no purge job — so the row is neither recoverable
              nor actually erased, and both halves of that are worth saying plainly.
            */
            note="No way to restore one yet, and nothing purges them either"
          />
          <Stat term="Export" value="Not yet" note="No way to download everything in one file" />
        </dl>
      </section>

      {/* ── Danger ── */}
      <div className="mt-6 border-t border-rule pt-4">
        <NotYet label="Delete my account and everything in it">
          Account deletion is not built. It needs a decision about what “immediate” means while the
          offline outbox may still be replaying writes, so it is deliberately absent rather than
          half-working.
        </NotYet>
      </div>

      <p className="mt-auto pt-8 pb-2 text-meta leading-loose text-ink-3 [text-wrap:pretty]">
        Your documents live in one space that only you can read. Nothing here is shared with anyone.
      </p>
    </div>
  )
}

/**
 * One `term / value` line, as a description list rather than a `<div>` pair.
 *
 * `<dl>` is the semantic that makes "Documents / 2" announce as a pair. A row of two spans reads as
 * two unrelated strings, which for a screen that is *entirely* label-and-number is the whole content.
 */
function Stat({
  term,
  value,
  note,
  action,
  /**
   * Mono, and only for a value that is a **number**.
   *
   * design.md §3 gives mono one job — what the machine names: eyebrow labels, masks, serials, counts.
   * Applying it to every value put "Single user" and "Gone from every list" in a typewriter face,
   * which reads as code rather than as an answer. Counts get mono because a column of digits should
   * align; sentences get the sans they are written in.
   */
  numeric = false,
}: {
  term: string
  value: string
  note?: string
  action?: React.ReactNode
  numeric?: boolean
}) {
  return (
    <div className="flex min-h-12 items-baseline justify-between gap-3.5 border-b border-rule py-3">
      <dt className="text-body text-ink-2">
        {term}
        {note !== undefined && <span className="mt-px block text-meta text-ink-3">{note}</span>}
      </dt>
      {/* One `<dd>` per `<dt>`, so the value and its control stay inside the same pair rather than
          the control becoming an orphan definition with no term. */}
      <dd className="flex shrink-0 items-baseline gap-2.5 text-right">
        <span className={numeric ? 'font-mono text-row' : 'text-body'}>{value}</span>
        {action !== undefined && <span className="-mr-3">{action}</span>}
      </dd>
    </div>
  )
}

/**
 * A control the design draws for a feature that does not exist.
 *
 * It renders as a **disabled** button with the reason beside it, rather than an enabled one that does
 * nothing when tapped. A dead control is the failure mode this codebase has already shipped in visual
 * form twice; `disabled` puts it in the accessibility tree as unavailable instead of lying about it.
 */
function NotYet({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      {/* `destructive` is text in `--status-late`, never a filled red block — design.md §4. Disabled
          drops it to 50% opacity, which is what a not-yet destructive action should look like: present
          in the design, unavailable in fact. */}
      <Button variant="destructive" size="sm" disabled>
        {label}
      </Button>
      <p className="mt-1.5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        Not yet — {children}
      </p>
    </div>
  )
}

/**
 * The reminder state, in the same four shapes `NotificationsCard` uses — but as a *status* rather than
 * an ask.
 *
 * Deliberately not a second copy of the subscribe flow. The ask is earned by having a document with a
 * date on it (see `NotificationsCard`), and offering it here, decoupled from any real date, is exactly
 * the abstract permission prompt that component exists to avoid. This tells you where you stand and
 * sends you to Now to act.
 */
function PushStatus() {
  const publicKey = useQuery({
    queryKey: ['push', 'public-key'],
    queryFn: api.push.publicKey,
    staleTime: Number.POSITIVE_INFINITY,
  })

  // No keys on this deployment: the feature vanishes entirely, here as everywhere else. A greyed-out
  // "notifications" row would teach the user about a feature that cannot work.
  if (publicKey.isPending || publicKey.data === null || publicKey.data === undefined) return null

  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  const { title, body } = !supported
    ? {
        title: 'This browser can’t do notifications',
        body: 'Add Life Manager to your home screen and open it from there.',
      }
    : Notification.permission === 'denied'
      ? {
          title: 'Reminders are blocked by your phone',
          body: 'Settings → Notifications → Life Manager → Allow. The dates are still on Now either way.',
        }
      : Notification.permission === 'granted'
        ? {
            title: 'Reminders are on',
            body: '90, 30 and 7 days before an expiry. Documents without an expiry stay silent — by design.',
          }
        : {
            title: 'Reminders are not on yet',
            body: 'Now will offer once you have a document with an expiry date.',
          }

  return (
    <Card className="mt-5 p-4">
      <p className="text-row font-medium leading-snug">{title}</p>
      <p className="mt-1 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">{body}</p>
    </Card>
  )
}
