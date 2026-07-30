import { createFileRoute, Link } from '@tanstack/react-router'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { DocumentListSkeleton } from '@/components/ui/skeleton'
import { useOpenAdd } from '@/features/documents/AddSheetProvider'
import { DocumentRow } from '@/features/documents/DocumentRow'
import { ExpiryGlyph, formatDate, NEEDS_YOU_DAYS } from '@/features/documents/ExpiryStatus'
import { GettingStarted } from '@/features/documents/GettingStarted'
import { Horizon } from '@/features/documents/Horizon'
import { NotificationsCard } from '@/features/documents/NotificationsCard'
import {
  buildHorizon,
  type HorizonEntry,
  type Ledger,
  toLedger,
  useLedger,
} from '@/features/documents/useLedger'
import { useThings } from '@/features/things/useThings'
import { useFeel } from '@/lib/useFeel'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/_authed/home')({ component: NowPage })

/**
 * At or below this many documents, Now shows `GettingStarted` instead of the space a fuller archive
 * would occupy.
 *
 * Four, because that is roughly where the screen stops looking half-loaded: one "Needs you" card plus
 * two or three horizon entries fills a 390×844 viewport. It is a **display** threshold with nothing
 * behind it — no reminder, no query, no server rule reads this, so getting it wrong costs a paragraph
 * appearing one document too early or too late.
 */
const GETTING_STARTED_MAX = 4

/**
 * **Now** — the screen the whole design turns on. ADR-0025 §1.
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

/**
 * Exported for `features/documents/Horizon.test.tsx`, which renders the whole screen to prove it
 * survives a failing Things request. The router reaches it through `Route`; nothing else imports it.
 */
export function NowPage() {
  const documents = useLedger()
  /**
   * ═══════════════════════════════════════════════════════════════════════════════════
   *  The second domain joins the horizon, and it must NEVER be able to take Now down.
   * ═══════════════════════════════════════════════════════════════════════════════════
   *
   * There is no Things API yet (things.md §10), so this request **404s in production today** and will
   * keep failing until another session builds the server half. Now is the app's home screen: it has to
   * degrade to a documents-only horizon rather than showing an error, and above all it must not go
   * blank.
   *
   * Three things deliver that, and none of them is optional:
   *
   *  - The result is read through `isSuccess` and nothing else. Neither `isError` nor `isPending` is
   *    branched on for *rendering* — both simply contribute no thing events, which is the same code
   *    path as a space that owns nothing.
   *  - It is **not** awaited by a route guard, so it cannot hang the launch (the D49/D50 class of bug —
   *    see `App.tsx`). It is an ordinary component query and the screen paints without it.
   *  - The 404 is not retried: `query-client.ts` refuses to retry an `ApiError` under 500, so this
   *    costs exactly one request per mount rather than a loop.
   *
   * The one thing that *does* change on failure is the footer's honesty — see `horizonComplete`.
   */
  const things = useThings()
  const openAdd = useOpenAdd()
  const { copy } = useFeel()

  /**
   * `null` until the documents request succeeds.
   *
   * The render below reaches `NowBody` only when this is non-null, which is unreachable-but-checked: the
   * pending and error branches come first, so a successful query is all that is left. Written as a
   * narrowing rather than asserted, because `noNonNullAssertion` is a lint error and rendering nothing
   * is the safe failure for a state that cannot occur.
   */
  const ledger = documents.isSuccess
    ? toLedger(documents.data.data, documents.data.next_cursor)
    : null
  /** `[]` when the Things request has not succeeded — pending or failed, same treatment. */
  const thingList = things.isSuccess ? things.data.data : []
  const entries = ledger === null ? [] : buildHorizon(ledger.horizon, thingList)
  /**
   * "That's every date we hold" is a strong claim, so it needs **both** domains fully accounted for:
   * the archive fitted in one page AND the things list loaded completely.
   *
   * A Things failure therefore softens the footer to "there may be more further out", which is the
   * honest sentence for "a whole domain is unreachable" as well as for "the archive spilled a page".
   * Note what this costs and why it is worth it: while the things request is in flight the footer reads
   * the hedged version and then firms up, so the last line of a long page can change once on load. A
   * momentary hedge is a better failure than a confident total that is wrong.
   */
  const horizonComplete =
    ledger?.complete === true && things.isSuccess && things.data.next_cursor === null

  return (
    /**
     * `flex-1` and a column, so the ledger footer can be pushed to the FOOT of the page.
     *
     * Without it this was a plain `<div>`: the shell is `min-h-dvh`, so on a sparse archive the
     * content stopped a third of the way down and left a screen's worth of dead space between the
     * footer and the tab bar. Reported from a real phone with one undated document — the emptiest
     * real state there is, and the one the stub fixtures never showed because they always had twelve
     * documents in them.
     *
     * The footer is a page-foot summary; in a printed ledger the totals line sits at the bottom of the
     * sheet, not wherever the entries happen to run out. `mt-auto` on it does nothing when the page is
     * long, so this costs the populated case nothing.
     */
    <div className="flex flex-1 flex-col">
      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         The date, and Add.
        ═══════════════════════════════════════════════════════════════════════════════════

        This row used to carry the theme toggle and Sign out, as quiet text, because the app had no
        settings surface and ADR-0025 §10 recorded that as a deviation to undo "once there are more
        than two". **`/you` is that surface**, so both have moved there and this row is back to what
        the design draws — with Add in the corner now that it is no longer a tab.
      */}
      <div className="flex items-center justify-between gap-3">
        <Eyebrow>
          {/* Warm: "Thursday 30 July". Plain: "30 Jul 2026". The `dateTime` stays machine-ISO in
              both — the register changes the human face, never the semantics. */}
          <time dateTime={todayIso()}>{copy.todayLabel(new Date())}</time>
        </Eyebrow>
        {/*
          Add, as text with a hairline plus glyph — not the ink-filled block it was as a tab. On the
          screen whose subject is *dates you already own*, the loudest thing should not be the button
          for owning more. The Documents screen gets the emphatic pill instead, because that is the
          screen you are on when you have a document in your hand.
        */}
        <Button
          variant="quiet"
          size="sm"
          className="-mr-3 shrink-0 gap-1.5 text-row text-ink-2"
          onClick={openAdd}
        >
          <span aria-hidden="true" className="relative block size-[13px]">
            <span className="absolute top-[5.5px] left-0 h-[2px] w-[13px] rounded-[1px] bg-current" />
            <span className="absolute top-0 left-[5.5px] h-[13px] w-[2px] rounded-[1px] bg-current" />
          </span>
          Add
        </Button>
      </div>

      {documents.isPending ? (
        <div className="pt-6">
          <DocumentListSkeleton count={3} />
        </div>
      ) : documents.isError ? (
        <div className="pt-5">
          <Card tone="late" className="p-card">
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
      ) : ledger !== null ? (
        <NowBody ledger={ledger} entries={entries} horizonComplete={horizonComplete} />
      ) : null}
    </div>
  )
}

function NowBody({
  ledger,
  entries,
  horizonComplete,
}: {
  ledger: Ledger
  /** The merged cross-domain timeline. `ledger.horizon` is only the documents half of it. */
  entries: HorizonEntry[]
  horizonComplete: boolean
}) {
  const { needsYou, horizon, withoutScan, datedCount, loadedCount, complete } = ledger
  const { copy } = useFeel()

  if (loadedCount === 0) return <ZeroState />

  /**
   * The soonest dated **document**, for the all-clear headline's "the next date is…".
   *
   * ── Deliberately not the soonest entry on the merged horizon ──
   *
   * `copy.nowSub` writes "Next expiry 4 Mar 2026" in the plain register, and a warranty end is **not
   * an expiry** — that is the whole of ADR-0029 and design.md §2a. Feeding a thing's date into a
   * sentence that names it an expiry would make the app say the one thing the two ladders exist to
   * stop it saying, and in its loudest voice.
   *
   * So the headline stays documents-only and the *timeline* is where the cross-domain answer lives. If
   * the headline should ever speak for both domains, that is a new sentence in `lib/voice.ts` in both
   * registers (design.md §12), not a different argument passed to this one.
   */
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
      {/*
        The headline and its sub are the app's VOICE — warm ("One thing needs you.") or plain
        ("1 item due"). The words live in `lib/voice.ts`; this screen supplies the counts and the
        next date and asks for them. The all-clear sub still answers the question in both registers —
        "the next date is 4 March" / "Next expiry 4 Mar 2026" — because "nothing" is the one answer
        this screen exists to avoid.
      */}
      <h1 className="mt-2.5 font-heading text-display font-face-h leading-[1.15] tracking-heading">
        {copy.nowHeadline(needsYou.length, loadedCount)}
      </h1>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
        {copy.nowSub({
          attention: needsYou.length,
          total: loadedCount,
          nextDate:
            next !== null && next.document.expires_on !== null
              ? formatDate(next.document.expires_on)
              : null,
          nextRelative: next?.expiry.label.replace('in ', '') ?? null,
        })}
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
          <Card tone="ok" className="flex gap-3.5 p-card">
            <span className="flex w-3.5 shrink-0 justify-center pt-[3px]">
              {/* The ring, unpulsed, in the ok tone: the ladder's "today" glyph reused to say
                  "checked". The pulse means one thing only, so it is switched off here. */}
              <ExpiryGlyph state="today" className="text-status-ok [animation:none]" />
            </span>
            <div>
              <p className="text-row font-medium leading-snug">{copy.clearTitle(NEEDS_YOU_DAYS)}</p>
              <p className="mt-1 text-body leading-relaxed text-ink-2">
                {copy.clearBody(datedCount)}
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

      {/*
        The timeline, both domains. `datedDocuments` is the DOCUMENT count and is used only by the
        empty branch — the "N more further out" arithmetic is computed inside `Horizon` from `entries`,
        so it stays exact as domains join. See that file's footer note.
      */}
      <Horizon entries={entries} datedDocuments={datedCount} complete={horizonComplete} />

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
        A nearly-empty archive gets told what to add next, rather than being shown the empty half of a
        screen designed for a full one. `complete` is required: without the whole archive loaded,
        `loadedCount` is a page size and every archive would look tiny on first paint.
      */}
      {complete && loadedCount <= GETTING_STARTED_MAX && <GettingStarted count={loadedCount} />}

      {/*
        The ledger footer. Every number is derived from what was actually loaded, and `complete` is
        what keeps it honest — see `useLedger`. The API has no count endpoint, so an exact total is
        only claimable when the whole archive fitted in one page.
      */}
      {/* `mt-auto` is what pushes this to the foot of a sparse page — see the note on the root
          element. On a full page there is no slack to take up and it behaves as a normal margin.
          It works because `NowBody` returns a FRAGMENT, so this `<p>` is a direct child of that
          root flex column. Wrapping this component's output in a `<div>` silently restores the
          gap: `mt-auto` would then take up slack in a box that has none. */}
      <p className="mt-auto mb-2 border-t border-rule pt-6 text-meta leading-loose text-ink-3 [text-wrap:pretty]">
        {complete ? loadedCount : `${loadedCount}+`} {loadedCount === 1 ? 'document' : 'documents'}{' '}
        · {datedCount} with a date we watch · {withoutScan.length} without a scan.
      </p>
    </>
  )
}

/**
 * The zero state. ADR-0025 §7: never an illustration — a sentence in the serif, one instruction, one
 * control.
 *
 * The comp put a live input here, making this the only empty state in the app with a field inline.
 * This routes to `/documents/new` instead, and the difference is deliberate: a second create form
 * would be a second thing to keep in step with `documentCreateSchema`, and the tap it saves is paid
 * exactly once in the app's lifetime — on the first document ever added. One create path is worth
 * more than one tap.
 */
function ZeroState() {
  const { copy } = useFeel()
  return (
    <>
      {/* The empty-ledger voice — `nowHeadline(0, 0)` and `nowSub` with a zero total both return
          their "nothing stored yet" branch, so this screen speaks the same register as a full one. */}
      <h1 className="mt-2.5 font-heading text-display font-face-h leading-[1.15] tracking-heading">
        {copy.nowHeadline(0, 0)}
      </h1>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
        {copy.nowSub({ attention: 0, total: 0, nextDate: null, nextRelative: null })}
      </p>

      <Card dashed className="mt-6 p-5">
        <Eyebrow>Start here</Eyebrow>
        <p className="mt-2.5 font-heading text-[1.25rem] font-face-h leading-snug">
          {copy.zeroLine}
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

/**
 * The machine-readable twin for `<time datetime>`, in LOCAL date parts.
 *
 * The human label moved to `lib/voice.ts` (`copy.todayLabel`), because the register decides whether
 * it reads "Thursday 30 July" or "30 Jul 2026" — but the ISO datetime is the same in both, so it
 * stays here rather than joining the voice set.
 */
function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
