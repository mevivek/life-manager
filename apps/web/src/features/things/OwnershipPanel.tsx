import type { Thing } from '@life-manager/shared'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatDateShort } from '@/features/documents/ExpiryStatus'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUpdateThing } from './useThings'

/**
 * Ownership. things.md §4 rule 4, ADR-0029, comp lines 707–716 and 871–889.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  OWNERSHIP IS A STATE, NEVER A DELETE.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * People lend things and sell them, and the record has to survive both — because **proving what you
 * handed over and when is a large part of why anyone files a receipt**. A "sold" thing that vanished
 * from the archive would delete the evidence at the moment it became useful.
 *
 * `here` → `lent` → `here` is a loan. `here` → `gone` is a sale or a gift. Three consequences the rest
 * of the domain depends on, none of them this file's to enforce but all of them this file's to *cause*:
 *
 *  - **`gone` is excluded from the sum insured and from the Now horizon.** You no longer own it, and a
 *    warranty on somebody else's dishwasher is not your deadline.
 *  - **`lent` is excluded from neither.** It is still yours, and its reminders carry on.
 *  - **`gone` is dimmed in the list, not hidden.** Hiding it would make the archive lie about what it
 *    holds.
 *
 * ── The triple moves together, and every write here sends all three ──
 *
 * `ownership`, `ownership_who` and `ownership_since` are one fact in three columns, and
 * `thingUpdateSchema`'s own comment says the service is what keeps them consistent. The client still
 * sends all three explicitly rather than relying on it: `PATCH` semantics are "an absent key means
 * don't change" (conventions/api.md §8), so a patch that set only `ownership: 'here'` and trusted the
 * server to clear the other two would be a client depending on a server-side fix-up it cannot see. The
 * same reasoning as `holder` and `relation` never outliving each other.
 *
 * ── There is no fourth state, and "lost" is the obvious request ──
 *
 * `ownershipSchema`'s note answers it: lost or stolen would be `gone` plus a reason, and the reason
 * belongs in `notes` until someone can say what the app would *do* differently with it.
 */

/** The one narrow slice both halves need. A whole `ThingDetailResponse` would be more than either uses. */
type OwnershipFields = Pick<
  Thing,
  'id' | 'name' | 'ownership' | 'ownership_who' | 'ownership_since' | 'version'
>

/**
 * The banner, at the top of the screen when the thing is **away**.
 *
 * At the top rather than beside the delete control, because it changes how everything under it should be
 * read: a cover card and a service history belong to something the reader may not currently have.
 *
 * Dashed, on `--sunken`, with the tag in tone — the comp's own treatment, and it is the "this is a
 * state, not an alarm" idiom. Note there is no `--status-late` anywhere in it: neither lending nor
 * selling is a problem.
 */
export function OwnershipBanner({ thing }: { thing: OwnershipFields }) {
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateThing(thing.id)

  if (thing.ownership === 'here') return null

  const lent = thing.ownership === 'lent'

  async function bringBack() {
    setError(null)
    try {
      /**
       * The version the screen was **rendered from** — ADR-0024. Not a fresh read: a patch carrying a
       * just-refetched version defeats the precondition it exists to enforce. If the record moved on
       * while this banner was on screen, the server refuses with 409 rather than overwriting.
       *
       * All three fields, and the two nulls are the point: returning a thing to `here` clears who has
       * it and when it left, in one statement, for the same reason `relation` cannot outlive `holder`.
       */
      await update.mutateAsync({
        version: thing.version,
        ownership: 'here',
        ownership_who: null,
        ownership_since: null,
      })
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That did not save. Check your connection and try again.',
      )
    }
  }

  return (
    <div className="mt-3.5 rounded-3 border border-dashed border-rule-2 bg-sunken px-4 py-3.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <span
          className={cn(
            'font-mono text-label font-medium uppercase tracking-label',
            // `--status-soon` for a loan, because it is a thing to follow up. `gone` gets `--ink-3`:
            // it is settled, and colour in this system is spent on status that wants an action.
            lent ? 'text-status-soon' : 'text-ink-3',
          )}
        >
          {lent ? 'With someone else' : 'No longer yours'}
        </span>
        <Button
          variant="quiet"
          size="bare"
          className="px-1 text-body text-ink"
          disabled={update.isPending}
          onClick={() => void bringBack()}
        >
          {/*
            "It's back with me" for a loan — the real event. "Undo" for `gone`, because there is no
            event that reverses a sale; the only reason to press it is that the state was set by mistake.
          */}
          {update.isPending ? 'Saving…' : lent ? 'It’s back with me' : 'Undo'}
        </Button>
      </div>

      <p className="mt-1.5 text-row font-medium leading-snug">{awayLabel(thing)}</p>
      <p className="mt-1 text-meta leading-relaxed text-ink-2 [text-wrap:pretty]">
        {lent
          ? 'Still yours, just not in the house. Reminders carry on.'
          : /*
              The honest note, and the comp's own words. Two facts a person selling a car actually needs:
              the paperwork does not follow the object out of the door (rule 5), and this app does not
              transfer anything — a registration or a policy is a separate job with a separate authority.
              What the record *is* good for is proving the handover happened.
            */
            'Its documents stay in Documents. Transferring the registration or the policy is a separate job — this record is what proves the handover.'}
      </p>

      {error !== null && <Alert className="mt-2.5">{error}</Alert>}
    </div>
  )
}

/**
 * `Lent to Priya · 30 Jul 2026`, and each half is optional.
 *
 * `ownership_who` is free text and **optional even when not `here`** (things.md §3) — you can lend
 * something without recording to whom — so the comp's `"Lent to " + a.who` would print "Lent to null".
 * `ownership_since` is nullable for the same reason.
 *
 * Exported for the test: this is a sentence assembled from three nullable fields, which is exactly the
 * shape that goes wrong on the row nobody made a fixture for.
 */
export function awayLabel(
  thing: Pick<Thing, 'ownership' | 'ownership_who' | 'ownership_since'>,
): string {
  const who = thing.ownership_who
  const named = who !== null && who.trim() !== ''
  const verb = thing.ownership === 'lent' ? 'Lent' : 'Handed'

  const stem = named ? `${verb} to ${who}` : thing.ownership === 'lent' ? 'Lent out' : 'Handed on'
  return thing.ownership_since === null
    ? stem
    : `${stem} · ${formatDateShort(thing.ownership_since)}`
}

/**
 * The control that puts a thing away, drawn only while it is `here`.
 *
 * ── Two choices, and asking for them is the whole point ──
 *
 * The comp's copy is *"Then pick one — that's what saves it."* The name field is optional and the
 * **choice is not**, because `lent` and `gone` differ in three places downstream (the sum insured, the
 * horizon, the row's dimming) and a single "it's gone" button would have to guess which. So the panel
 * offers the name first, as a courtesy, and then the two buttons that actually record something.
 *
 * `Lent out` carries a 1.5px `--ink` border where `Sold or given away` carries the ordinary hairline.
 * That is **weight, not fill** — design.md §4 allows the app exactly one emphatic control (the Add pill),
 * and the same `<Input emphasis>` idiom that draws "required" without an asterisk draws "the likelier
 * answer" here without a second ink button.
 */
export function OwnershipPanel({ thing }: { thing: OwnershipFields }) {
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState('')
  const [error, setError] = useState<string | null>(null)
  const update = useUpdateThing(thing.id)

  if (thing.ownership !== 'here') return null

  async function setAway(ownership: 'lent' | 'gone') {
    setError(null)
    try {
      await update.mutateAsync({
        // The version this screen was rendered from — see the note in `OwnershipBanner`.
        version: thing.version,
        ownership,
        /**
         * `null` rather than `''` for a name the user did not give. An empty string is a blank that is
         * not absent — it sorts differently and reads as a person called nothing (conventions/api.md
         * §8). The comp substitutes "someone" / "a new owner" here, which invents a value the user
         * declined to enter and then shows it back to them as fact.
         */
        ownership_who: who.trim() === '' ? null : who.trim(),
        // Today, in local date parts. `ownership_since` is a calendar date, and `toISOString()` would
        // record tomorrow for anyone east of Greenwich late in the evening.
        ownership_since: isoToday(),
      })
      setOpen(false)
      setWho('')
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'That did not save. Check your connection and try again.',
      )
    }
  }

  if (!open) {
    return (
      <section className="mt-6 border-t border-rule pt-4">
        <Button variant="secondary" className="w-full text-ink-2" onClick={() => setOpen(true)}>
          It’s not with me any more
        </Button>
      </section>
    )
  }

  const named = who.trim() !== ''

  return (
    <section className="mt-6 border-t border-rule pt-4">
      <Card className="px-4 py-3.5">
        <p className="text-body font-medium">Where has it gone?</p>

        {/* A real `<label>` with `htmlFor` — `Eyebrow` is for headings that label no control, and a
            `<label>` pointing at nothing is announced as a form label that then finds nothing. */}
        <Label htmlFor="ownership-who" className="mt-3 block">
          Who has it
        </Label>
        <Input
          id="ownership-who"
          className="mt-1.5"
          value={who}
          placeholder="Optional"
          onChange={(event) => setWho(event.target.value)}
        />

        <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          Then pick one — that’s what saves it.
        </p>

        {error !== null && <Alert className="mt-2.5">{error}</Alert>}

        <div className="mt-2.5 flex flex-col gap-2">
          <Button
            variant="secondary"
            // Weight, not fill. See the block comment above.
            className="min-h-[3.125rem] justify-start border-[1.5px] border-ink bg-sunken text-left"
            disabled={update.isPending}
            onClick={() => void setAway('lent')}
          >
            {named ? `Lent to ${who.trim()} — still mine` : 'Lent out — still mine'}
          </Button>
          <Button
            variant="secondary"
            className="min-h-[3.125rem] justify-start bg-sunken text-left"
            disabled={update.isPending}
            onClick={() => void setAway('gone')}
          >
            {named ? `Handed to ${who.trim()} — new owner` : 'Sold or given away — new owner'}
          </Button>
          <Button
            variant="quiet"
            onClick={() => {
              setOpen(false)
              setWho('')
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </Card>
    </section>
  )
}

/** Today as `YYYY-MM-DD` in local date parts — see the note at the call site. */
function isoToday(today = new Date()): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}
