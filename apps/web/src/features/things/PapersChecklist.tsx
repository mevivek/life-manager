import type { DocumentType, LinkedDocument, Thing } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { Eyebrow } from '@/components/ui/label'
import { ExpiryStatus } from '@/features/documents/ExpiryStatus'

/**
 * *"Papers this one needs"* — the 2×2 grid, and **only vehicles have one**. things.md §7, comp lines
 * 788–800.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This is the feature the whole domain exists for.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * things.md §1: a car carries four dated papers — registration, insurance, roadworthiness, service
 * record — and *the only place they are naturally indexed together is the car*. Filed as documents
 * alone they are four rows in an archive of forty, related to each other by a coincidence of titles.
 * ADR-0029 names this as the thing a `doc_type` could never do: there would be no way to ask "which
 * papers does this car have".
 *
 * ── Deliberately NOT generalised to other kinds ──
 *
 * things.md §9(3), and it is a product decision rather than an oversight: **a laptop's "papers it
 * needs" is a receipt, and a checklist of one is a nag.** A grid of four slots is a useful frame when
 * four papers genuinely exist and three of them are legally required; the same grid with one filled slot
 * and three blanks invents obligations the owner does not have. So the guard is on `kind`, and widening
 * it needs an answer to §9(3) rather than a loop over a longer table.
 *
 * ── A filled slot is solid, an empty one is dashed ──
 *
 * The same "this is an absence to be filled" idiom as the no-scan page marker and the dashed `Chip` —
 * so the grid reads at a glance without the words being parsed. A filled slot carries the document's
 * **own** expiry status via `ExpiryStatus`, because the paper's validity is the paper's business and
 * there must not be a second ladder for it (design.md §2).
 */

/** What a slot expects, and what capture should be prefilled with when the slot is empty. */
export type PaperSlot = {
  /** The words on the tile — also the stem of the suggested document title. */
  label: string
  /**
   * The `doc_type` to prefill. Taken from the comp's `guessDoc()` (line 2150) with one correction:
   * roadworthiness maps to `certificate`, where the comp's own regex (`/certificate|mot|fitness|puc/`)
   * misses the word "Roadworthiness" entirely and falls through to `other`. An MOT, a PUC and a
   * fitness certificate are all certificates; the slot label is the general word for them.
   */
  docType: DocumentType
  /** Which of a thing's documents already fills this slot. Title keywords — see `SLOTS`. */
  matches: RegExp
}

/**
 * The four slots, in the order the comp draws them.
 *
 * ── The matching is a DISPLAY convenience, and it cannot hide anything ──
 *
 * There is no `slot` column and there should not be: the link is one nullable `thing_id` on the
 * document (things.md §3), and inventing a server-side taxonomy of vehicle papers would be a schema
 * for a guess. So a slot is filled by matching keywords in the document's **title**, which is the only
 * field the user chose.
 *
 * That is safe because it is not authoritative in either direction. A document the regexes miss still
 * appears in full under *"Its documents"* immediately below, so a wrong guess costs a shortcut and
 * hides nothing. And no rule anywhere reads this (invariant 5) — it decides which tile is solid.
 *
 * Keywords, not `doc_type`: an insurance policy and a bank statement are both `financial`, so the type
 * cannot separate them, while "insurance" in a title is what a person actually wrote.
 */
const SLOTS: readonly PaperSlot[] = [
  { label: 'Registration', docType: 'identity', matches: /registration|\brc\b|v5c|logbook/i },
  { label: 'Insurance', docType: 'financial', matches: /insurance|policy/i },
  {
    label: 'Roadworthiness',
    docType: 'certificate',
    matches: /roadworth|\bmot\b|fitness|\bpuc\b|emission/i,
  },
  { label: 'Service record', docType: 'other', matches: /service|\bfsh\b/i },
]

export function PapersChecklist({
  thing,
  documents,
  /**
   * Opens capture for an empty slot. Supplied by the route, which owns the Add sheet — see the note
   * there. A prop rather than `useOpenAdd()` called in here so this component is testable without
   * mounting the provider and the sheet behind it.
   */
  onCapture,
  today,
}: {
  thing: Pick<Thing, 'kind' | 'name'>
  documents: LinkedDocument[]
  onCapture: (slot: PaperSlot & { suggestedTitle: string }) => void
  today?: Date
}) {
  // things.md §9(3). The one guard, and widening it is a product decision — see the note above.
  if (thing.kind !== 'vehicle') return null

  const filled = matchSlots(documents)

  return (
    <section className="mt-6">
      <Eyebrow className="block pb-2.5">Papers this one needs</Eyebrow>
      {/*
        `grid-cols-2` and a 72px minimum per tile. Not a list: four short labels in two columns is
        scannable in one glance, which is the point of a checklist, and at 200% system text the tiles
        grow because the minimum is a `min-h`.
      */}
      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map((slot) => {
          const document = filled.get(slot.label)

          if (document !== undefined) {
            return (
              <Link
                key={slot.label}
                to="/documents/$documentId"
                params={{ documentId: document.id }}
                className="flex min-h-[4.5rem] flex-col justify-between gap-1 rounded-3 border border-rule-2 bg-raised px-3 py-3"
              >
                <span className="text-body font-medium leading-snug [text-wrap:pretty]">
                  {slot.label}
                </span>
                {/*
                  The document's own status, from the one ladder that owns expiry dates. A document
                  with no expiry renders "No expiry" rather than the comp's "Filed" — the comp invents
                  a fifth word for a state the ladder already has one for, and two vocabularies for
                  "this has no date" is exactly what design.md §2 forbids.
                */}
                <ExpiryStatus expiresOn={document.expires_on} today={today} />
              </Link>
            )
          }

          return (
            <button
              key={slot.label}
              type="button"
              onClick={() =>
                onCapture({ ...slot, suggestedTitle: `${slot.label} — ${thing.name}` })
              }
              className="flex min-h-[4.5rem] flex-col justify-between gap-1 rounded-3 border border-dashed border-rule-2 bg-transparent px-3 py-3 text-left active:bg-sunken hover:bg-sunken"
              // The tile's own words are "Registration" and "Not filed", which read as a status rather
              // than an action. The accessible name says what tapping does.
              aria-label={`File the ${slot.label.toLowerCase()} for ${thing.name}`}
            >
              <span className="text-body font-medium leading-snug [text-wrap:pretty]">
                {slot.label}
              </span>
              {/* `--ink-3`, never a warning tone: an unfiled paper is an absence, and design.md §4 is
                  explicit that absence is drawn in the same grey as any unfilled value. */}
              <span className="text-meta text-ink-3">Not filed</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Which document fills which slot. One document fills at most one slot, and each slot takes at most
 * one document.
 *
 * The order matters and is `SLOTS`' order: "Vehicle insurance policy" matches both the insurance and
 * (via `policy`) nothing else, but "Service policy schedule" would match two, and a document appearing
 * in two tiles would make the grid claim four papers where three exist. First slot wins, and the
 * claimed document is removed from the pool.
 *
 * Exported for the test, which is the only place the pairing can be asserted without reading pixels.
 */
export function matchSlots(documents: LinkedDocument[]): Map<string, LinkedDocument> {
  const unclaimed = [...documents]
  const filled = new Map<string, LinkedDocument>()

  for (const slot of SLOTS) {
    const index = unclaimed.findIndex((document) => slot.matches.test(document.title))
    if (index === -1) continue
    const [claimed] = unclaimed.splice(index, 1)
    if (claimed !== undefined) filled.set(slot.label, claimed)
  }

  return filled
}

/** The slot labels, in order — for the test, so it does not hardcode a second copy of the list. */
export const PAPER_SLOT_LABELS: readonly string[] = SLOTS.map((slot) => slot.label)
