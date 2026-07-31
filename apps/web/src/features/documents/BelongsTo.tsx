import { type DocumentDetailResponse, KIND_LABELS } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Eyebrow } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useThing, useThings } from '@/features/things/useThings'
import { useUpdateDocument } from './useDocuments'

/**
 * **Belongs to** — the document side of the one link between the two domains. Handoff 4, comp 533–560.
 * ADR-0029, things.md §7.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  One nullable column, read from both sides. This is the paperwork side.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `documents.thing_id` is the whole relationship — not a join table, because a receipt for one
 * dishwasher does not belong to a second dishwasher (ADR-0029 § *Alternatives*). The thing's own screen
 * draws *"Its documents"* from the same column; **one endpoint sets it**, and it is
 * `PATCH /documents/:id`, because that is where the column lives.
 *
 * ── The version is the one thing that is easy to get wrong here ──
 *
 * The patch carries the version **captured when the picker was opened**, held in the `picking` state
 * itself — not `document.version` read at the moment of the tap. That is ADR-0024's precondition, and
 * reading the live prop to "make sure it is current" is precisely the defeat of it: `useDocument`
 * refetches on window focus, so choosing a thing, backgrounding the app and coming back to tap would
 * send whatever version the refetch handed us. The server's `where version = :expected` would then
 * match and the other device's edit would vanish without a word. Opening the picker is the moment the
 * user read this screen, so it is the moment the precondition is taken. `useDocuments.ts` says the same
 * thing about the edit form.
 *
 * ── `useUpdateDocument` may not return a document ──
 *
 * Offline it returns `{ queued: true }` and the link lands in the outbox (ADR-0024). So the success path
 * branches, and the queued branch says so rather than pretending the link exists — the card below it is
 * still drawn from `thing_id`, which has not changed yet.
 *
 * ── The Things API does not exist yet, and this screen must not look broken because of it ──
 *
 * things.md §10: there are no endpoints, so `useThing` and `useThings` **404 today**. Two consequences
 * are handled deliberately rather than incidentally:
 *
 *  - The picker's request only fires when the picker is **open** (the hook lives in a child that is not
 *    mounted until then), so an ordinary unlinked document costs no failing request at all. When it is
 *    opened, it says what happened in a sentence and offers a retry — it never spins.
 *  - A *linked* document still draws its card and still navigates, with the thing's name replaced by an
 *    honest placeholder. The link is a fact we hold locally; only the name needs the server.
 */
export function BelongsTo({ document }: { document: DocumentDetailResponse }) {
  /**
   * The version this screen was read at, or `null` when the picker is closed.
   *
   * One piece of state rather than two, so the open flag and the version it was opened at cannot
   * disagree — and so a call site cannot reach for the live prop by accident. See the block comment.
   */
  const [picking, setPicking] = useState<number | null>(null)
  /** Set when the write went to the outbox instead of the server. Cleared by the next attempt. */
  const [queued, setQueued] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const update = useUpdateDocument(document.id)

  async function link(thingId: string, versionRead: number) {
    setFailure(null)
    setQueued(false)
    try {
      const result = await update.mutateAsync({ thing_id: thingId, version: versionRead })
      setPicking(null)
      // `Document` has no `queued` key, so this narrows without a cast. ADR-0024.
      if ('queued' in result) setQueued(true)
    } catch (error) {
      // A 409 means the document moved on while this screen was open — the precondition doing its job.
      // Inline, never modal (design.md §6): the context that explains it is the screen behind it.
      setFailure(error instanceof Error ? error.message : 'The link could not be saved.')
    }
  }

  return (
    <section className="mt-6">
      <div className="pb-2.5">
        <Eyebrow>Belongs to</Eyebrow>
      </div>

      {/*
        ═══════════════════════════════════════════════════════════════════════════════════
         `!= null`, not `!== null` — and that is debt D46, not a style preference.
        ═══════════════════════════════════════════════════════════════════════════════════

        The persisted Query cache is rehydrated **without re-running Zod** (`lib/persister.ts`), so a
        document cached by a build that predates `thing_id` arrives with the key *absent* — and
        `undefined !== null` is `true`. This section then drew a linked card for a document linked to
        nothing: `LinkedThingCard thingId={undefined}` fetching `/things/undefined`, a `<Link>` with an
        undefined param, and the words "Something you own — couldn't load its details" under
        **Belongs to** on a document that belongs to nothing.

        `packages/shared`'s `.nullish().default(null)` does not save us here: a Zod default only fires
        when the schema RUNS, and the whole premise of D46 is the restore path that never runs it. So
        the branch has to tolerate both, which is what `IdentifierCard` already does — see its note.
      */}
      {document.thing_id != null ? (
        <LinkedThingCard thingId={document.thing_id} />
      ) : picking !== null ? (
        <ThingPicker
          busy={update.isPending}
          onCancel={() => setPicking(null)}
          onPick={(thingId) => void link(thingId, picking)}
        />
      ) : (
        /**
         * `dashed`, and that is the variant's whole meaning (`ui/button.tsx`): an **invitation** to add
         * something optional. A solid button here would read as a step the user is expected to
         * complete, and most documents belong to no object at all.
         */
        <Button
          variant="dashed"
          className="w-full"
          // Opening the picker is what takes the precondition: this is the version the user read.
          onClick={() => setPicking(document.version)}
        >
          Link this to something you own
        </Button>
      )}

      {queued && (
        <Alert variant="notice" className="mt-2">
          Saved on this device. The link will be sent when you’re back online — you can watch it in
          the outbox.
        </Alert>
      )}
      {failure !== null && (
        <Alert className="mt-2">
          {failure}
          <Button
            variant="quiet"
            size="sm"
            className="mt-1 block px-0"
            onClick={() => setFailure(null)}
          >
            Dismiss
          </Button>
        </Alert>
      )}
    </section>
  )
}

/**
 * The linked thing, as a tappable card.
 *
 * The hook is in its own component so it is only called when there **is** a `thing_id` — a
 * `useThing(id ?? '')` would fire a request for a document that is linked to nothing, on every detail
 * screen in the archive.
 *
 * `useThing` fetches the thing's *detail*, which is more than a name and a kind. That is deliberate: the
 * list response would need the thing to be on the first page, and a thing filed two years ago would
 * silently render as "not found" on a document that is perfectly well linked.
 */
function LinkedThingCard({ thingId }: { thingId: string }) {
  const thing = useThing(thingId)

  return (
    <Link
      to="/things/$thingId"
      params={{ thingId }}
      className="flex min-h-14 items-center gap-3 rounded-3 border border-rule-2 bg-raised px-4 py-3.5"
    >
      {/*
        Two upright bars of different heights — the comp's mark for "an object", drawn rather than
        iconised because it appears exactly once. `aria-hidden`: the card's text is its whole meaning.
      */}
      <span aria-hidden="true" className="flex h-[15px] w-[17px] shrink-0 items-end gap-[2px]">
        <span className="h-[9px] w-[5px] rounded-[1px] border-2 border-ink-3" />
        <span className="h-[14px] w-[8px] rounded-[1px] border-2 border-ink-3" />
      </span>

      <span className="min-w-0 flex-1">
        {thing.isPending ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          <span className="block truncate text-body font-medium leading-snug">
            {/*
              On a failed read the link is still real — `thing_id` came from the document — so the row
              stays tappable and names what it can. "Something you own" rather than "Unknown": the
              second reads as data loss, and nothing was lost.
            */}
            {thing.isSuccess ? thing.data.name : 'Something you own'}
          </span>
        )}
        <span className="mt-px block truncate text-meta text-ink-3">
          {thing.isSuccess
            ? KIND_LABELS[thing.data.kind]
            : thing.isError
              ? 'Couldn’t load its details — tap to open it'
              : ''}
        </span>
      </span>

      <span
        aria-hidden="true"
        className="h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
      />
    </Link>
  )
}

/**
 * The inline picker.
 *
 * A list of buttons in one bordered card, not a `<select>` and not a second sheet — design.md §6 forbids
 * dropdowns outright, and a sheet on top of a detail screen to choose between four appliances is a
 * modal for a decision that is not urgent.
 *
 * Every non-list state says a **sentence**, because "couldn't load" with a spinner underneath is how a
 * missing API looks like a broken app. This is the surface where that matters most: it is the first
 * place a user meets Things from the Documents side.
 */
function ThingPicker({
  onPick,
  onCancel,
  busy,
}: {
  onPick: (thingId: string) => void
  onCancel: () => void
  busy: boolean
}) {
  const things = useThings()

  return (
    <Card className="p-2">
      {things.isPending ? (
        <p className="px-2 py-3 text-body text-ink-2">Looking up what you own…</p>
      ) : things.isError ? (
        <div className="px-2 py-3">
          <p className="text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
            Couldn’t load your things. {things.error.message}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void things.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : things.data.data.length === 0 ? (
        <p className="px-2 py-3 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
          Nothing in Things yet. Add the object first, then come back and link this to it.
        </p>
      ) : (
        <ul className="list-none">
          {things.data.data.map((thing) => (
            <li key={thing.id}>
              <Button
                variant="quiet"
                className="min-h-tap w-full justify-between gap-3 px-3 text-ink"
                disabled={busy}
                onClick={() => onPick(thing.id)}
              >
                <span className="min-w-0 truncate text-row font-medium">{thing.name}</span>
                <span className="shrink-0 text-meta text-ink-3">{KIND_LABELS[thing.kind]}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}

      <Button variant="quiet" className="w-full" disabled={busy} onClick={onCancel}>
        Cancel
      </Button>
    </Card>
  )
}
