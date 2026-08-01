import { useId, useState } from 'react'
import { Chip } from '@/components/ui/chip'
import { Sheet } from '@/components/ui/sheet'
import { useHolders } from '@/features/documents/useDocuments'
import { PersonSheet } from './PersonSheet'
import { usePeople } from './usePeople'

/**
 * *"Whose document is this?"* — the sheet behind the Whose field on a document's detail screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The options are the UNION of two lists, and the reader has to know there are two.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * [ADR-0034](../../../../docs/decisions/0034-people-is-a-directory.md) is explicit that the directory
 * is *not* the only source of names:
 *
 *  - **`GET /people`** — the names the user has deliberately added, which may include somebody with
 *    nothing filed under them yet. That is the whole reason the table exists; a `SELECT DISTINCT`
 *    over `holder` cannot represent a person with no records.
 *  - **`GET /documents/holders`** — the names derived from the documents themselves, so a holder typed
 *    during capture before anyone was added to People is still offered.
 *
 * Offering only the first would drop names the user is already filing under. Offering only the second
 * is what the app did before this domain existed. So both, de-duplicated by name, directory first —
 * because the directory carries the relation the user chose rather than the one that happened to be
 * on the most recent record.
 *
 * ── "Mine" is the absence of a holder, not a person called Mine ──
 *
 * `holder: null` is how this system draws *you* — the same way `other` is the absence of a type. That
 * is why the account holder has no name anywhere in the app, and why picking Mine sends `null` rather
 * than a string (documents.md §4 rule 13).
 *
 * ── Picking navigates nowhere, which is why these are buttons ──
 *
 * design.md §8's `<Link>` rule is about navigation. A chip here mutates the document under the sheet
 * and leaves you on the same screen; there is no address to give it.
 */
export function WhoseSheet({
  open,
  onClose,
  holder,
  onPick,
}: {
  open: boolean
  onClose: () => void
  /** The document's current holder. `null` means it is the owner's own. */
  holder: string | null
  /** Called with the chosen holder and the relation that came with them. */
  onPick: (holder: string | null, relation: string | null) => void
}) {
  const headingId = useId()
  /**
   * Whether the "+ Someone else" branch is open.
   *
   * The two sheets **swap** rather than stack: `open && !adding` closes this one as the other opens,
   * so there is never a dialog on top of a dialog. Two live focus traps at once is a keyboard dead
   * end, and the library's own picker test asserts the same one-dialog rule for the Add fork.
   */
  const [adding, setAdding] = useState(false)

  const people = usePeople()
  const derived = useHolders()

  const options = whoOptions(
    (people.data?.data ?? []).map((person) => ({
      holder: person.name,
      relation: person.relation,
    })),
    derived.data ?? [],
  )

  return (
    <>
      <Sheet open={open && !adding} onClose={onClose} labelledBy={headingId}>
        <h2 id={headingId} className="font-heading text-[1.4375rem] font-face-h leading-tight">
          Whose document is this?
        </h2>
        <p className="mt-1.5 text-body leading-normal text-ink-2 [text-wrap:pretty]">
          They get no account and no notification — it just files it under their name.
        </p>

        <div className="mt-4.5 flex flex-wrap gap-1.5">
          <Chip selected={holder === null || holder === ''} onClick={() => onPick(null, null)}>
            Mine
          </Chip>
          {options.map((option) => (
            <Chip
              key={option.holder}
              selected={holder === option.holder}
              onClick={() => onPick(option.holder, option.relation)}
            >
              {option.relation === null || option.relation === ''
                ? option.holder
                : `${option.holder} · ${option.relation}`}
            </Chip>
          ))}
          {/* Dashed, because it opens something rather than making a choice — the same language as
              the capture form's "Someone else" and the no-scan page marker. */}
          <Chip variant="dashed" onClick={() => setAdding(true)}>
            + Someone else
          </Chip>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-5 min-h-12 w-full text-row font-medium text-ink-3 active:text-ink-2"
        >
          Cancel
        </button>
      </Sheet>

      {/*
        Adding somebody from here files the document under them in the same gesture. Adding a person
        and then having to pick them from a list you were already looking at is the tap this door
        exists to save — the comp does the same thing (`personFrom: "doc"`).
      */}
      <PersonSheet
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(person) => {
          setAdding(false)
          onPick(person.name, person.relation)
        }}
      />
    </>
  )
}

/**
 * The directory and the derived holders, de-duplicated by name with the directory winning.
 *
 * Exported for its own test: this is the one function that decides whether a name the user typed at
 * capture disappears the day they add somebody to People, and a set-union written inline in a render
 * is a set-union nobody can assert on.
 */
export function whoOptions(
  directory: readonly { holder: string; relation: string | null }[],
  derivedHolders: readonly { holder: string; relation: string | null }[],
): { holder: string; relation: string | null }[] {
  const seen = new Set(directory.map((person) => person.holder))
  return [
    ...directory,
    ...derivedHolders.filter((person) => person.holder !== '' && !seen.has(person.holder)),
  ]
}
