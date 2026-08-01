import type { Person } from '@life-manager/shared'
import { createFileRoute, Link, Outlet, useChildMatches } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import { useDocuments } from '@/features/documents/useDocuments'
import { PersonAvatar } from '@/features/people/PersonAvatar'
import { PersonSheet } from '@/features/people/PersonSheet'
import { personMeta, YOU_PERSON_ID } from '@/features/people/personMeta'
import { usePeople } from '@/features/people/usePeople'
import { useThings } from '@/features/things/useThings'

export const Route = createFileRoute('/_authed/people')({ component: PeopleRoute })

/**
 * **People** — the directory, reached from a row on You.
 * [ADR-0034](../../../../docs/decisions/0034-people-is-a-directory.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This route is also the PARENT of `/people/$personId`, which is why it renders an Outlet.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * TanStack's flat file routes nest on the dot: `people.$personId.tsx` generates with
 * `getParentRoute: () => AuthedPeopleRoute`, so this component stays mounted while a person is open.
 * The person screen **replaces** the directory rather than sitting inside it — it has its own back
 * link, its own heading and its own footer — so when a child matches, this renders nothing but the
 * outlet. Drawing the list above it would put two headings and two back links on one screen.
 *
 * (The alternative spelling is `people_.$personId.tsx`, which un-nests the child and makes this an
 * ordinary leaf route. It is the same screen either way; this is the shape the files are in.)
 */
function PeopleRoute() {
  const children = useChildMatches()
  if (children.length > 0) return <Outlet />
  return <PeopleScreen />
}

/**
 * The directory itself: a **You** row, one row per person, an invitation to add another, and a
 * footnote that says what a rename and a removal actually do.
 *
 * ── Nobody here has an account, and the screen leads with that ──
 *
 * The comp's own subtitle — *"Everyone you file for. Nobody here has an account and nobody gets
 * notified — it's your filing, kept under their name."* — is the most important sentence on the
 * screen, and it is why it sits under the heading rather than in a footnote. A list of names in an
 * app that also has sign-in reads as a sharing feature unless it says otherwise, and this one is not:
 * `space_id` is the only thing that decides who can read a record (invariant 2), and a holder is a
 * label (documents.md §4 rule 13).
 */
export function PeopleScreen() {
  const [editing, setEditing] = useState<Person | null>(null)
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const people = usePeople()
  const directory = people.data?.data ?? []

  /**
   * The **You** row's counts: everything with no holder against it.
   *
   * `YOU_PERSON_ID` is `HOLDER_MINE`, the API's own sentinel for `holder IS NULL` — a literal string
   * rather than an empty `?holder=`, for the reason `documentListQuerySchema` gives. Every other row
   * gets its counts from the server on the person itself; this one has no person to hang them on.
   *
   * Both are page reads, so past a page the numbers are floors — hence `approx`, which is debt D33's
   * rule applied here: a floor rendered as a total is the `file_count` bug in a different costume.
   */
  const myDocuments = useDocuments({ holder: YOU_PERSON_ID })
  const myThings = useThings({ holder: YOU_PERSON_ID })
  const mineApprox =
    myDocuments.data?.next_cursor != null || myThings.data?.next_cursor != null ? '+' : ''

  return (
    <div className="flex flex-1 flex-col">
      {/* Back to You, not only the tab bar's You. Both land in the same place, and a screen reached
          from a row needs a way out that does not require finding the bar. */}
      <Link
        to="/you"
        className="-ml-1 inline-flex min-h-tap w-fit items-center gap-[7px] px-1 text-body font-medium text-ink-2"
      >
        <span
          aria-hidden="true"
          className="h-3 w-[7px] rotate-45 border-b-[1.5px] border-l-[1.5px] border-ink-2"
        />
        You
      </Link>

      <h1 className="mt-1 font-heading text-title font-face-h leading-tight">People</h1>
      <p className="mt-2 text-body leading-normal text-ink-2 [text-wrap:pretty]">
        Everyone you file for. Nobody here has an account and nobody gets notified — it’s your
        filing, kept under their name.
      </p>

      <div className="-mx-gutter mt-5 border-t border-rule px-gutter">
        {/*
          You, first and always — the comp's `{me:true}` row prepended to the directory.

          It is not a person in the table and never will be: "mine" is the *absence* of a holder, and
          giving the account holder a row in their own directory would be the first step toward
          giving them a name the app then has to keep in sync with their email.
        */}
        <PersonRow
          personId={YOU_PERSON_ID}
          name="You"
          initial="•"
          meta={personMeta({
            documentCount: myDocuments.data?.data.length ?? null,
            thingCount: myThings.data?.data.length ?? null,
            approx: mineApprox,
          })}
        />

        {people.isPending && (
          <div className="flex min-h-row items-center gap-3.5 border-b border-rule py-row-pad">
            <Skeleton className="h-[38px] w-[38px] rounded-pill" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}

        {directory.map((person) => (
          <PersonRow
            key={person.id}
            personId={person.id}
            name={person.name}
            initial={person.name}
            meta={personMeta({
              relation: person.relation,
              documentCount: person.document_count,
              thingCount: person.thing_count,
            })}
            onEdit={() => setEditing(person)}
          />
        ))}
      </div>

      {people.isError && (
        <p className="mt-3 text-meta leading-relaxed text-status-late [text-wrap:pretty]">
          The directory could not be loaded. Everything is still filed under the names it already
          has — this list is only what the app offers you.
        </p>
      )}

      {/*
        The empty state: a sentence in the serif, one instruction, one control (design.md §6). The
        instruction is the footer below, which is already the comp's — so this adds the sentence and
        nothing else, rather than a second block saying the same thing twice.
      */}
      {!people.isPending && directory.length === 0 && (
        <p className="mt-5 font-heading text-serif-row font-face-h leading-snug">
          Nobody else yet — everything is filed under you.
        </p>
      )}

      <div className="mt-4">
        <Button variant="dashed" className="w-full" onClick={() => setAdding(true)}>
          Add someone
        </Button>
      </div>

      <p className="mt-3.5 pb-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        {directory.length === 0
          ? 'Add the people you file for, and their name is one tap away when you capture a document.'
          : 'Renaming someone renames them everywhere they’re filed. Removing them leaves the documents alone.'}
      </p>

      <PersonSheet open={adding} onClose={() => setAdding(false)} onSaved={setToast} />
      {/*
        `key` on the edit sheet, so opening a second person after a first seeds the form from the
        person actually tapped. `PersonSheet` seeds its draft when it mounts (see its header note);
        without a key React would reuse the instance and the fields would still hold the previous
        person.
      */}
      <PersonSheet
        key={editing?.id ?? 'none'}
        open={editing !== null}
        person={editing}
        onClose={() => setEditing(null)}
        onSaved={setToast}
      />

      {/* No `action`: there is nothing an Undo could call. See ui/toast.tsx. */}
      {toast !== null && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  )
}

/**
 * One row: the initial circle, the name, the relation and counts beneath, Edit, a chevron.
 *
 * ── The Edit button is a SIBLING of the link, not inside it ──
 *
 * `<button>` inside `<a>` is invalid HTML and browsers disagree about the nested activation — the
 * same constraint `DocumentRow` works around for its Copy and Show controls. So the row is a flex
 * container holding a `<Link>` that takes the space, then the button, then the chevron.
 *
 * The chevron therefore sits outside the link. It is `aria-hidden` decoration either way, and losing
 * seven pixels of hit area at the far edge of the row is a better trade than an invalid tree.
 */
function PersonRow({
  personId,
  name,
  initial,
  meta,
  onEdit,
}: {
  /** The `$personId` segment — a uuid, or `mine` for the You row. */
  personId: string
  name: string
  /** A name to take the first letter of, or a literal glyph for the You row. */
  initial: string
  meta: string
  /** Absent on the You row: there is nothing in the directory to edit. */
  onEdit?: () => void
}) {
  return (
    <div className="flex items-center border-b border-rule">
      <Link
        to="/people/$personId"
        params={{ personId }}
        // design.md §9: the row's accessible name carries what the meta line says, because the
        // relation and the counts are the whole difference between two rows called Arun.
        aria-label={meta === '' ? name : `${name} — ${meta}`}
        className="flex min-h-row min-w-0 flex-1 items-center gap-3.5 py-row-pad"
      >
        <PersonAvatar name={initial} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-row font-medium leading-snug">{name}</span>
          {meta !== '' && (
            <span className="mt-[3px] block truncate text-meta text-ink-3">{meta}</span>
          )}
        </span>
      </Link>

      {onEdit !== undefined && (
        <Button
          variant="quiet"
          size="bare"
          className="shrink-0 px-2.5 text-meta"
          // "Edit" alone repeats down the list with nothing to tell one from the next — the rule
          // design.md §9 states for a badge applies to a repeated control just as directly.
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
      )}

      <span
        aria-hidden="true"
        className="ml-1.5 h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
      />
    </div>
  )
}
