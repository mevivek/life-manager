import type { Thing } from '@life-manager/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip } from '@/components/ui/chip'
import { Eyebrow } from '@/components/ui/label'
import { Stat } from '@/components/ui/stat'
import { useHolders } from '@/features/documents/useDocuments'
import { toLedger, useLedger } from '@/features/documents/useLedger'
import {
  pushSupported,
  usePushPublicKey,
  useSubscribeToPush,
  useUnsubscribeFromPush,
} from '@/features/documents/usePush'
import { BuildCard } from '@/features/health/BuildCard'
import { meQueryOptions } from '@/features/spaces/useMe'
import { coverOf } from '@/features/things/CoverStatus'
import { formatMoney } from '@/features/things/money'
import {
  findContentsPolicy,
  fromMinorUnits,
  totalInsurable,
} from '@/features/things/SumInsuredCard'
import { useThings } from '@/features/things/useThings'
import type { Feel } from '@/lib/feel'
import { endSession } from '@/lib/session'
import { useFeel } from '@/lib/useFeel'
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
  const { feel, set } = useFeel()

  /**
   * `meQueryOptions`, not a third hand-written copy of the same query.
   *
   * This used to be `useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60 * 1000 })`,
   * which is not merely duplication: two observers on one key with different `networkMode` values
   * means whichever registers first decides how the *shared* query behaves. Mounting this screen
   * could therefore put `['me']` back on the default `'online'` mode and re-break the offline launch
   * that `features/spaces/useMe.ts` exists to fix. The longer `staleTime` is kept — it is a genuine
   * per-screen choice, and unlike `networkMode` it is safe to vary per observer.
   */
  const me = useQuery({ ...meQueryOptions, staleTime: 5 * 60 * 1000 })

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

  /**
   * The things, for the figures and the App rows handoff 5 adds.
   *
   * The same unfiltered key the library's sum-insured card uses, so on a session that has already
   * opened Everything this is served from cache rather than refetched. `next_cursor` drives its own
   * `+` for exactly the reason the ledger's does: past one page a count is a floor.
   */
  const thingsQuery = useThings({ sort: 'name', order: 'asc', limit: 100 })
  const things = thingsQuery.data?.data ?? []
  const thingsApprox = thingsQuery.data != null && thingsQuery.data.next_cursor !== null ? '+' : ''

  /** What you still own. A `gone` thing keeps its record but is not a possession any more. */
  const owned = things.filter((thing) => thing.ownership !== 'gone')

  /**
   * Every date the daily scan is watching, across both domains — a document's expiry, a thing's
   * warranty end, a thing's next service. Counted on `owned` rather than on everything, because a
   * warranty on something you handed on is not a date anyone is waiting for.
   */
  const datesWatched =
    (ledger?.datedCount ?? 0) +
    owned.filter((thing) => thing.warranty_ends_on !== null || thing.service_due_on !== null).length

  /** Warranties that have run out. `coverOf` is the one ladder that decides what "ended" means. */
  const outOfCover = owned.filter((thing) => coverOf(thing).state === 'ended').length

  /**
   * Lent out and handed on, counted separately because they are different facts: one is an open loop
   * you may want to close, the other is settled (things.md §4 rule 4, and the reason a thing row tints
   * the two differently).
   */
  const elsewhere = describeElsewhere(things)

  const space = me.data?.spaces[0] ?? null
  /** Holders other than the owner. `+ 1` for "you" is done at the render, so the zero case is clear. */
  const people = useHolders().data ?? []

  return (
    <div className="flex flex-1 flex-col">
      <h1 className="mt-2.5 font-heading text-title font-face-h leading-tight">You</h1>

      {/* ── Account ── */}
      <Card className="mt-4 p-card">
        <Eyebrow>Account</Eyebrow>
        <p className="mt-2.5 font-heading text-serif-row font-face-h leading-snug">
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

      {/*
        ── What we hold ──

        ═══════════════════════════════════════════════════════════════════════════════════
         A ROW OF FIGURES, which is what the comp draws (handoff 4, lines 392–399).
        ═══════════════════════════════════════════════════════════════════════════════════

        This was a `<dl>` of `Stat` rows, which is the right primitive for the App section below —
        label on the left, answer on the right, one line each — and the wrong one here. The comp puts
        three **28px mono figures side by side** with a small label under each, and it is right to: a
        count is read as a magnitude, and three magnitudes beside each other are comparable in a way
        three right-aligned values on separate lines are not. The rest of this screen was rewritten
        around honesty (see the header note) and this row was left in the old shape by omission.

        The labels are the comp's own words too — *"Documents filed"*, *"Expiries watched"*, *"Missing
        a scan"* — rather than the longer ones this carried. They are short because they sit under a
        figure, and each is still true.

        `flex-wrap`, which the comp does not need: the fourth figure only exists once somebody else is
        filed for, and four of these do not fit 390px.
      */}
      <section className="mt-5">
        <Eyebrow>What we hold</Eyebrow>
        <dl className="mt-3.5 flex flex-wrap gap-x-7 gap-y-4">
          <Figure term="Documents filed" value={count(ledger?.loadedCount, approx)} />
          {/*
            Things owned, beside documents filed — handoff 5. The app holds two collections now, and a
            "what we hold" section that counted only one of them was answering half its own question.

            `gone` is excluded: a thing you handed on is still a record, deliberately (things.md §4
            rule 4), but it is not something you *own*, and this figure is captioned as ownership.
          */}
          <Figure term="Things owned" value={count(owned.length, thingsApprox)} />
          {/*
            *Dates watched*, replacing *Expiries watched* — one figure across both domains, because a
            warranty ending and a service falling due are watched by exactly the same daily scan as a
            passport expiring. Two separate figures would have implied two mechanisms.
          */}
          <Figure term="Dates watched" value={count(datesWatched, approx || thingsApprox)} />
          {/*
            Only once someone else is filed for. On a single-person archive "1 including you" is a
            statistic about nothing, and it would imply the app does something with people that it
            does not — holders are a label, and nobody is invited.
          */}
          {people.length > 0 && (
            <Figure term="People filed for" value={`${people.length + 1}`} note="Including you" />
          )}
        </dl>
      </section>

      {/* ── Reminders ── */}
      <PushStatus />

      {/* ── Numbers ──
          The card that used to *describe* masking now **owns** it — ADR-0034. Masking was
          unconditional and reversed by a tap in three different places (a Reveal on the document
          card, a Show on every row, a page-wide Show in the library header); it is one preference
          here instead, and it is off by default. */}
      <Card tone="sunken" className="mt-5 p-card">
        <p className="text-row font-medium leading-snug">Numbers are kept in full</p>
        <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
          Passport, Aadhaar, licence and policy numbers are stored whole, because a number you can’t
          read is a number you’ll go and dig the original out for.
        </p>
        {/*
          The comp says "kept in full and **encrypted at rest**". They are kept in full — ADR-0026 —
          but nothing here is encrypted: invariant 7 and ADR-0009 reserve application-level encryption
          for the vault. This paragraph is that sentence made true, and it is not a footnote: it is the
          only place the app tells its user how their Aadhaar number is actually held, so stating the
          limitation is what makes the sentence above it worth believing.

          The last line is the honest framing of the setting below, and it is why hiding is a
          preference rather than a protection: the value is in the response before anything is tapped
          (ADR-0027), so what a mask buys is a stranger's glance, not a boundary.
        */}
        <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          They are not encrypted — the database holds them as text, like every other field. Hiding
          them is about shoulders near your screen, not about the server.
        </p>
        <div className="mt-3.5 border-t border-rule pt-3.5">
          <FeelChoice
            label="On screen"
            // "On this device" for the same reason the Feel section says it: this is localStorage,
            // not the account, so the phone and the laptop can disagree on purpose.
            hint="Hidden draws •••• and the last four, with a Show on each. On this device."
            value={feel.numbers}
            options={[
              { value: 'shown', label: 'Shown' },
              { value: 'hidden', label: 'Hidden' },
            ]}
            onChange={(value) => set('numbers', value as Feel['numbers'])}
          />
        </div>
      </Card>

      {/* ── App ── */}
      <section className="mt-5">
        <Eyebrow>App</Eyebrow>
        <dl className="mt-1">
          {/*
            ── What you own, in four sentences — handoff 5 ──

            These are answers rather than settings, which is why they sit in `App` as read-only rows.
            Each one is a question the library can show you but not *state*: the library draws a bar,
            a cover tag and a dimmed row; this says the number out loud.

            All four are derived from the same helpers those screens use — `totalInsurable`,
            `coverOf`, `awayLabel` — never re-implemented here. Two screens computing "what do I own"
            separately is how they come to disagree, and the disagreement would be invisible until
            somebody put them side by side.
          */}
          <ValueOfThings things={owned} approx={thingsApprox} />
          <Stat
            term="Out of cover"
            value={
              outOfCover === 0
                ? 'Nothing'
                : `${outOfCover}${thingsApprox} ${outOfCover === 1 ? 'thing' : 'things'}`
            }
            note={
              outOfCover === 0
                ? 'Everything with a warranty is still inside it'
                : 'Worth knowing before you call anyone'
            }
          />
          <Stat
            term="Missing a scan"
            value={
              (ledger?.withoutScan.length ?? 0) === 0
                ? 'None'
                : // Singular at one. "1 documents" shipped for exactly one render of this screen and
                  // is the kind of thing only a screenshot catches.
                  `${count(ledger?.withoutScan.length, approx)} ${
                    ledger?.withoutScan.length === 1 ? 'document' : 'documents'
                  }`
            }
            note={
              (ledger?.withoutScan.length ?? 0) === 0
                ? 'Every document has a file against it'
                : 'A number without a picture of the thing it came from'
            }
          />
          <Stat term="Elsewhere" value={elsewhere.value} note={elsewhere.note} />
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

      {/* ── Build ──
          Directly after App, because it answers the same question one level down: not "what does this
          app do" but "which copy of it am I looking at". See BuildCard.tsx for why the comparison is
          the feature and the version string on its own is not. */}
      <BuildCard />

      {/* ── Feel ── */}
      <section className="mt-5">
        <Eyebrow>Feel</Eyebrow>
        <p className="mt-1.5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          {/*
            "On this device" is the load-bearing phrase: these are stored in localStorage, not the
            account, so someone can run compact on the phone and generous on the laptop — the same
            reasoning as the theme, `lib/feel.ts`. Naming it here is what stops "why didn't my laptop
            change?" from reading as a bug.
          */}
          On this device. The app remembers these here, not on your account.
        </p>
        <div className="mt-3.5 flex flex-col gap-4">
          <FeelChoice
            label="Density"
            hint="How much room the rows and cards take."
            value={feel.density}
            options={[
              { value: 'generous', label: 'Generous' },
              { value: 'compact', label: 'Compact' },
            ]}
            onChange={(value) => set('density', value as Feel['density'])}
          />
          <FeelChoice
            label="Headings"
            hint="The face used for titles and headlines."
            value={feel.face}
            options={[
              { value: 'serif', label: 'Serif' },
              { value: 'grotesk', label: 'Grotesk' },
            ]}
            onChange={(value) => set('face', value as Feel['face'])}
          />
          <FeelChoice
            label="Voice"
            hint="Warm speaks in sentences; plain states the facts."
            value={feel.voice}
            options={[
              { value: 'warm', label: 'Warm' },
              { value: 'plain', label: 'Plain' },
            ]}
            onChange={(value) => set('voice', value as Feel['voice'])}
          />
        </div>
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
 * One Feel preference: a label, a one-line hint, and a chip row where exactly one is selected.
 *
 * Chips rather than a native control for the same reason the rest of the app has none (ADR-0025 §7,
 * `chip.tsx`): a two-option `<select>` on a phone opens an OS sheet to hide two words behind one.
 *
 * A `<fieldset>`/`<legend>` groups the options — the same shape as the people picker in
 * `DocumentForm`, and the semantic element biome insists on over a `role="group"` div. The legend
 * names the group, and each chip's `aria-pressed` carries which one is on.
 *
 * `value`/`onChange` are typed as `string` rather than a generic: the `options` array is the source
 * of valid values, and threading a type parameter through TSX buys nothing the call site's own typing
 * (`set('density', v as Feel['density'])`) does not already give.
 */
function FeelChoice({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="float-left text-row font-medium leading-snug">{label}</legend>
      {/* `float-left` on the legend clears the float so the hint sits under it — a legend is not a
          flow element, so it needs the same handling as the DocumentForm one. */}
      <p className="clear-both pt-0.5 text-meta leading-snug text-ink-3">{hint}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) => (
          <Chip
            key={option.value}
            selected={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </div>
    </fieldset>
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
/**
 * *Value of things* — the same total the library's sum-insured bar draws, said as a sentence.
 *
 * ── It renders nothing without a contents policy, and that is not a bug ──
 *
 * The total is only meaningful in a currency, and the currency this app trusts is the **policy's**,
 * never a guessed symbol (`money.ts`, and the `£` the comp hardcodes). `findContentsPolicy` is what
 * supplies it. With no policy filed there is no currency to state the total in and no cover to state
 * it against, so the row is absent rather than showing a bare number — the same "draw it the day the
 * thing exists" rule the sum-insured card itself follows.
 *
 * `totalInsurable` is imported, never re-implemented: it encodes that `gone` things are excluded and
 * that a thing priced in another currency is skipped rather than converted. A second copy here could
 * disagree with the bar on the library, and nobody would notice until they compared the two screens.
 */
function ValueOfThings({ things, approx }: { things: Thing[]; approx: string }) {
  const ledger = useLedger()
  const policy = findContentsPolicy(ledger.data?.data ?? [])
  if (policy === null) return null

  const total = totalInsurable(things, policy.currency)
  const format = (amount: string) => formatMoney(amount, policy.currency, 'whole') ?? ''
  const value = format(fromMinorUnits(total.minorUnits))
  const short = total.minorUnits > toMinor(policy.value)

  return (
    <Stat
      term="Value of things"
      value={`${value}${approx}`}
      /*
        The note carries the comparison, and names what the number LEAVES OUT. A total that silently
        omits three things priced in another currency is a total that is wrong by an unknown amount,
        so `skipped` is stated rather than swallowed — the same reason the card's own footer states it.
      */
      note={[
        short
          ? `More than the ${format(policy.value)} your ${policy.document.title.toLowerCase()} covers`
          : `Within the ${format(policy.value)} your ${policy.document.title.toLowerCase()} covers`,
        total.skipped === 0 ? null : `${total.skipped} priced in another currency, not counted`,
      ]
        .filter((part) => part !== null)
        .join(' · ')}
    />
  )
}

/** `"14200.50"` → `1420050`, for the one comparison this screen makes. Mirrors `SumInsuredCard`. */
function toMinor(decimal: string): number {
  return Math.round(Number(decimal) * 100)
}

/**
 * What is not with you: lent out, handed on, or neither.
 *
 * Two counts rather than one, because "3 elsewhere" would merge a loop you might want to close with
 * one that is finished. When both are zero the row still draws — "Everything's with you" is a real
 * answer, and this section is a list of answers.
 */
function describeElsewhere(things: Thing[]): { value: string; note: string } {
  const lent = things.filter((thing) => thing.ownership === 'lent').length
  const gone = things.filter((thing) => thing.ownership === 'gone').length

  if (lent === 0 && gone === 0) {
    return { value: 'Nothing', note: 'Everything you\u2019ve filed is with you' }
  }

  const parts = [
    lent === 0 ? null : `${lent} lent out`,
    gone === 0 ? null : `${gone} handed on`,
  ].filter((part) => part !== null)

  return {
    value: parts.join(', '),
    note:
      gone === 0
        ? 'Still yours, just not in the house'
        : 'Handed-on things keep their record and stop counting toward cover',
  }
}

/**
 * One big mono figure with its label beneath — the comp's `youStats` (lines 392–399).
 *
 * Still a `<dt>`/`<dd>` pair inside a `<dl>`, for the reason `ui/stat.tsx` gives: "Documents filed /
 * 12" has to announce as a pair, and two stacked spans read as two unrelated strings. The *visual*
 * order is figure-then-label while the *document* order is label-then-figure — see the note on the
 * wrapper below.
 *
 * Local to this screen rather than in `components/ui/`: it is the one place in the app that draws a
 * figure this way, and a primitive with one caller is a primitive nobody can change safely.
 */
function Figure({ term, value, note }: { term: string; value: string; note?: string }) {
  return (
    /*
      `flex-col-reverse`, so the DOM order is `<dt>` then `<dd>` and the VISUAL order is figure then
      label. Both matter and they disagree: the comp draws the figure on top, and a screen reader has to
      hear "Documents filed" before "8" or the number is a bare digit with no subject.
    */
    <div className="flex flex-col-reverse">
      <dt className="mt-1.5 text-meta leading-snug text-ink-3">
        {term}
        {note === undefined ? '' : ` · ${note}`}
      </dt>
      {/* `text-display` (28px) is the token nearest the comp's 28px, in mono because a count is
          something the machine names — design.md §3. */}
      <dd className="font-mono text-display leading-none font-medium">{value}</dd>
    </div>
  )
}

/**
 * A count, or an em dash while the ledger has not loaded.
 *
 * `approx` is the `+` that keeps every figure here honest: past `LEDGER_PAGE_LIMIT` the number is a
 * floor, and a floor rendered as a total is debt D33 again in a different costume.
 */
function count(value: number | undefined, approx: string): string {
  return value === undefined ? '—' : `${value}${approx}`
}

function PushStatus() {
  const publicKey = usePushPublicKey()
  const subscribe = useSubscribeToPush()
  const unsubscribe = useUnsubscribeFromPush()
  const [error, setError] = useState<string | null>(null)
  /**
   * `Notification.permission` is a live global rather than React state, so a grant or a revoke does
   * not re-render anything on its own. This is bumped after either mutation to re-read it.
   */
  const [, bump] = useState(0)

  // No keys on this deployment: the feature vanishes entirely, here as everywhere else. A greyed-out
  // "notifications" row would teach the user about a feature that cannot work.
  if (publicKey.isPending || publicKey.data === null || publicKey.data === undefined) return null

  const supported = pushSupported()
  const permission = supported ? Notification.permission : 'default'

  const { title, body } = !supported
    ? {
        title: 'This browser can’t do notifications',
        body: 'Add Life Manager to your home screen and open it from there.',
      }
    : permission === 'denied'
      ? {
          title: 'Reminders are blocked by your phone',
          body: 'Settings → Notifications → Life Manager → Allow. The dates are still on Now either way.',
        }
      : permission === 'granted'
        ? {
            title: 'Reminders are on',
            body: '90, 30 and 7 days before an expiry. Documents without an expiry stay silent — by design.',
          }
        : {
            title: 'Reminders are not on yet',
            body: '90, 30 and 7 days before anything expires. Nothing else.',
          }

  const key = publicKey.data

  return (
    <Card className="mt-5 p-card">
      {/*
        ── The row carries a CONTROL now, not just a status — handoff 5 ──

        You said what the state was and left the only way to change it on the Now screen's nudge,
        which appears when a document has an expiry. So a user who turned reminders off, or who
        dismissed the nudge, had no route back to them from the one screen named after their own
        settings. That is the gap this closes.

        **Three states, and only one of them gets a button.** `denied` is the phone's decision and no
        web API can reverse it — a Turn on that cannot work is worse than the sentence explaining
        where the switch actually lives. `unsupported` is the same. Only `default` and `granted` are
        ours to change.
      */}
      <div className="flex items-start justify-between gap-3.5">
        <div className="min-w-0">
          <p className="text-row font-medium leading-snug">{title}</p>
          <p className="mt-1 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">{body}</p>
        </div>

        {supported && permission === 'default' && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={subscribe.isPending}
            onClick={() => {
              setError(null)
              subscribe.mutate(key, {
                onSuccess: () => bump((n) => n + 1),
                onError: (caught) =>
                  setError(
                    caught instanceof Error ? caught.message : 'Could not turn reminders on.',
                  ),
              })
            }}
          >
            {subscribe.isPending ? 'Turning on…' : 'Turn on'}
          </Button>
        )}

        {supported && permission === 'granted' && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            disabled={unsubscribe.isPending}
            onClick={() => {
              setError(null)
              unsubscribe.mutate(undefined, {
                onSuccess: () => bump((n) => n + 1),
                onError: (caught) =>
                  setError(
                    caught instanceof Error ? caught.message : 'Could not turn reminders off.',
                  ),
              })
            }}
          >
            {unsubscribe.isPending ? 'Turning off…' : 'Turn off'}
          </Button>
        )}
      </div>

      {/*
        Turning off unsubscribes this browser; the phone's own permission stays granted, so Turn on
        will not ask again. Said plainly, because otherwise "off" then "on" looks like it did nothing.
      */}
      {supported && permission === 'granted' && (
        <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          Turning them off stops this browser receiving them. Your phone keeps the permission, so
          turning them back on will not ask again.
        </p>
      )}

      {error !== null && (
        <p className="mt-2 text-meta leading-relaxed text-status-late [text-wrap:pretty]">
          {error}
        </p>
      )}
    </Card>
  )
}
