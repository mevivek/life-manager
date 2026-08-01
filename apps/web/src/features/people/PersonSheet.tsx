import type { Person, RenamedResponse } from '@life-manager/shared'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { countPhrase } from './personMeta'
import { RelationField } from './RelationField'
import { useCreatePerson, useDeletePerson, useUpdatePerson } from './usePeople'

/**
 * Add or edit somebody in the directory — the comp's `personSheet`.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  One sheet for both, because add and edit differ by three strings and a Remove control.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The comp draws it as one panel whose title, subtitle and button label switch on whether a person
 * is being edited, and that is right: the *form* is identical — a required name and an optional
 * relation — so two components would be two copies of the same two fields drifting apart.
 *
 * ── The form is a CHILD of `Sheet`, and that is load-bearing ──
 *
 * `Sheet` returns `null` when closed, so `PersonForm` unmounts on close and remounts on open. Every
 * piece of state it holds — the draft name, the draft relation, and the **version the sheet was
 * opened at** — is therefore seeded once per opening, by construction. The alternative (state in this
 * component, reset by an effect) is the shape that produces a form that either clears mid-typing when
 * a background refetch changes the person's identity, or keeps a stale draft from the person opened
 * before this one. Both have shipped in apps that did it that way.
 *
 * ── There is no "are you sure" on Remove, deliberately ──
 *
 * Every other destructive control in this app confirms first, because every other one destroys
 * something. This does not: removing a person is a soft delete of a **directory row**, and the note
 * beneath the button says exactly what survives — *"The 4 records filed under them keep the name."*
 * ADR-0034 chose a directory over a foreign key precisely so that sentence could be true. A
 * confirmation step here would teach the user that removing somebody is dangerous, which is the
 * opposite of what the screen has just told them.
 */
export function PersonSheet({
  open,
  onClose,
  person = null,
  onCreated,
  onSaved,
  onRemoved,
}: {
  open: boolean
  onClose: () => void
  /** The person being edited, or `null` to add somebody. */
  person?: Person | null
  /**
   * The person the server just created.
   *
   * Separate from `onSaved` because one caller needs the record rather than a sentence: the Whose
   * sheet files the document under the person it just added, which needs their name and relation.
   */
  onCreated?: (person: Person) => void
  /** A sentence for the calling screen to toast. Always fires on a successful write. */
  onSaved?: (message: string) => void
  onRemoved?: () => void
}) {
  const headingId = useId()

  return (
    <Sheet open={open} onClose={onClose} labelledBy={headingId}>
      <PersonForm
        headingId={headingId}
        person={person}
        onClose={onClose}
        onCreated={onCreated}
        onSaved={onSaved}
        onRemoved={onRemoved}
      />
    </Sheet>
  )
}

function PersonForm({
  headingId,
  person,
  onClose,
  onCreated,
  onSaved,
  onRemoved,
}: {
  headingId: string
  person: Person | null
  onClose: () => void
  onCreated?: (person: Person) => void
  onSaved?: (message: string) => void
  onRemoved?: () => void
}) {
  const nameId = useId()
  const relationId = useId()

  const [name, setName] = useState(person?.name ?? '')
  const [relation, setRelation] = useState(person?.relation ?? '')
  const [failure, setFailure] = useState<string | null>(null)

  /**
   * The version this sheet was **opened** at — ADR-0024, and the same rule `DocumentForm`'s
   * `seededVersion` and the delete confirmation's snapshot both follow.
   *
   * `usePeople` refetches on window focus, so `person.version` is live: a sheet left open while the
   * app was backgrounded comes back holding a newer number. Stamping the draft on screen with a
   * version the user never saw makes the server's `where version = :expected` match, and another
   * device's edit disappears instead of coming back as a 409.
   */
  const [seededVersion] = useState(person?.version ?? 1)

  const create = useCreatePerson()
  // `''` when adding — the hook is built either way (hooks cannot be conditional) and its mutation
  // is simply never fired on that branch.
  const update = useUpdatePerson(person?.id ?? '')
  const remove = useDeletePerson()

  const editing = person !== null
  const trimmed = name.trim()
  const busy = create.isPending || update.isPending || remove.isPending

  async function save() {
    if (trimmed === '') return
    setFailure(null)
    // `null` rather than `''` clears the column. `relation` is nullish on both request schemas, and
    // an empty string would be a stored blank that then renders as an empty meta segment.
    const nextRelation = relation.trim() === '' ? null : relation.trim()

    try {
      if (person === null) {
        const created = await create.mutateAsync({ name: trimmed, relation: nextRelation })
        onCreated?.(created)
        onSaved?.(`${created.name} added`)
      } else {
        const result = await update.mutateAsync({
          version: seededVersion,
          name: trimmed,
          relation: nextRelation,
        })
        onSaved?.(renameMessage(result))
      }
      onClose()
    } catch (error) {
      // Surfaced, never swallowed. Without this a failed save closes the sheet and the screen
      // redraws unchanged, which reads as a save that silently reverted.
      setFailure(error instanceof Error ? error.message : 'That could not be saved.')
    }
  }

  return (
    <div>
      <h2 id={headingId} className="font-heading text-[1.4375rem] font-face-h leading-tight">
        {editing ? `Edit ${person.name}` : 'Who are you filing for?'}
      </h2>
      <p className="mt-1.5 text-body leading-normal text-ink-2 [text-wrap:pretty]">
        {editing
          ? 'Change the name or the relation. Everything filed under them follows.'
          : 'A name is enough. The relation just helps you tell two Aruns apart.'}
      </p>

      <div className="mt-4.5 flex flex-col gap-1.5">
        {/* "Name · required" — the comp's own label. `emphasis` is how this system draws required
            (design.md §6): a 1.5px ink border rather than an asterisk. */}
        <Label htmlFor={nameId}>Name · required</Label>
        <Input
          id={nameId}
          emphasis
          value={name}
          placeholder="Priya"
          onChange={(event) => setName(event.target.value)}
        />
      </div>

      {/* The one relation field — chips plus free text. See `RelationField`. */}
      <RelationField id={relationId} value={relation} onChange={setRelation} className="mt-4" />

      <Button
        size="lg"
        className="mt-5 w-full"
        // Disabled at zero characters rather than validating on submit: the one required field on
        // the form is the one thing the button is waiting for, and saying so by weight is cheaper
        // than an error message that appears after a tap.
        disabled={trimmed === '' || busy}
        onClick={() => void save()}
      >
        {editing ? 'Save' : 'Add person'}
      </Button>

      {failure !== null && (
        <p className="mt-2 text-meta leading-relaxed text-status-late [text-wrap:pretty]">
          {failure}
        </p>
      )}

      {editing && (
        <div className="mt-4 border-t border-rule pt-3.5">
          <Button
            variant="destructive"
            size="bare"
            disabled={busy}
            onClick={async () => {
              setFailure(null)
              try {
                await remove.mutateAsync({ id: person.id, version: seededVersion })
                onSaved?.('Removed')
                onRemoved?.()
                onClose()
              } catch (error) {
                setFailure(error instanceof Error ? error.message : 'That could not be removed.')
              }
            }}
          >
            Remove {person.name}
          </Button>
          <p className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
            {removeNote(person)}
          </p>
        </div>
      )}

      {/*
        Cancel, not a bare backdrop tap. The backdrop is pointer-only decoration (see `Sheet`), so
        without this the keyboard's only exit is Escape — real, but undiscoverable.
      */}
      <button
        type="button"
        onClick={onClose}
        className="mt-2.5 min-h-12 w-full text-row font-medium text-ink-3 active:text-ink-2"
      >
        Cancel
      </button>
    </div>
  )
}

/**
 * *"The 4 records filed under them keep the name — they just stop being offered as a choice."*
 *
 * The number is the comp's, and it is the sentence ADR-0034 was written around: it is only true
 * because `holder` is a copied string rather than a foreign key. If somebody ever adds a
 * `person_id`, this note becomes a lie before the migration finishes.
 *
 * Counted **server-side** — a client that counted from a loaded page would be counting one page. When
 * the server does not send the counts at all (an older API; they are `nullish` for exactly that
 * reason, debt D54) the sentence drops the number rather than guessing zero: "nothing changes" would
 * be a promise this build cannot check.
 */
export function removeNote(person: Person): string {
  const documents = person.document_count
  const things = person.thing_count
  if (documents === null || things === null) {
    return 'Anything filed under them keeps the name — they just stop being offered as a choice.'
  }

  const total = documents + things
  if (total === 0) return 'Nothing is filed under them, so nothing changes.'
  return `The ${countPhrase(total, 'record')} filed under them keep the name — they just stop being offered as a choice.`
}

/**
 * What the rename actually touched, said out loud.
 *
 * The client cannot work this out: the rows the server changed are in two other domains and may not
 * be loaded, which is why `renamedResponseSchema` returns the counts at all. Zero is a normal answer
 * — renaming somebody with nothing filed under them touches nothing — and it gets the plain "Saved"
 * rather than "0 documents updated", which would read as a failure.
 */
export function renameMessage(result: RenamedResponse): string {
  const parts = [
    result.documents_updated === null || result.documents_updated === 0
      ? null
      : countPhrase(result.documents_updated, 'document'),
    result.things_updated === null || result.things_updated === 0
      ? null
      : countPhrase(result.things_updated, 'thing'),
  ].filter((part) => part !== null)

  if (parts.length === 0) return 'Saved'
  return `Saved — ${parts.join(' and ')} updated`
}
