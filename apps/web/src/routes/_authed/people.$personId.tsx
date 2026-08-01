import type { Document, Person } from '@life-manager/shared'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Toast } from '@/components/ui/toast'
import { DocumentRow } from '@/features/documents/DocumentRow'
import { libraryDocumentRowProps, type NumberDisplay } from '@/features/documents/documentRowProps'
import { expiryOf } from '@/features/documents/ExpiryStatus'
import { useDocuments } from '@/features/documents/useDocuments'
import { PersonSheet } from '@/features/people/PersonSheet'
import { personMeta, YOU_PERSON_ID } from '@/features/people/personMeta'
import { usePeople } from '@/features/people/usePeople'
import { ThingRow } from '@/features/things/ThingRow'
import { useThings } from '@/features/things/useThings'

export const Route = createFileRoute('/_authed/people/$personId')({ component: PersonRoute })

function PersonRoute() {
  const { personId } = Route.useParams()
  return <PersonScreen personId={personId} />
}

/**
 * One person's records — *"everything filed under this name"*, both kinds in one list.
 * [ADR-0034](../../../../docs/decisions/0034-people-is-a-directory.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The name IS the query. There is no join, and that is the decision rather than a shortcut.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * This screen asks the server for `?holder=<their name>` on both collections, because `holder` is a
 * plain string on `documents` and `things` and nothing points at the `people` row. So the list here
 * is *by construction* the same set the library shows filed under that name — including records for
 * a name typed at capture that was never added to the directory.
 *
 * The cost is stated in ADR-0034 and it is real: **two people with the same name are one row here.**
 * The relation in the heading is the mitigation the comp chose (*"it just helps you tell two Aruns
 * apart"*), not a fix.
 *
 * ── The rows are the library's rows, built by the library's builder ──
 *
 * `libraryDocumentRowProps` and `ThingRow`, not a third pair of row components. design.md §8 is
 * explicit that one builder decides what a document row looks like, because the last time two screens
 * built their own the same passport rendered with a different glyph column and different controls in
 * each — visible on screen, invisible to every test. A person's page is a third list of the same two
 * things, so it is a third caller and nothing more.
 */
export function PersonScreen({ personId }: { personId: string }) {
  const people = usePeople()

  /**
   * `mine` is the sentinel, not a uuid — see `personMeta.ts`. It is the row the directory draws first
   * and it has no `people` row behind it, so every "is there a person" branch below has to allow for
   * a `null` person that is nonetheless a real screen.
   */
  const isYou = personId === YOU_PERSON_ID
  const person = people.data?.data.find((candidate) => candidate.id === personId) ?? null

  if (!isYou && person === null) {
    return (
      <div className="flex flex-1 flex-col">
        <BackLink />
        {people.isPending ? (
          <div role="status" aria-label="Loading person" aria-live="polite">
            <Skeleton className="mt-3 h-7 w-44" />
            <Skeleton className="mt-4 h-16 w-full rounded-3" />
          </div>
        ) : (
          /*
            No speculation about *why* it is missing — the same discipline the document detail's 404
            copy keeps (invariant 4). Removing somebody from the directory is a normal thing to have
            done, and it does not touch their records, so the way out is the library rather than an
            apology.
          */
          <div className="px-8 py-14 text-center">
            <p className="font-heading text-[1.25rem] font-face-h leading-snug">
              Nobody by that name here
            </p>
            <p className="mt-2 text-body leading-relaxed text-ink-3 [text-wrap:pretty]">
              They may have been removed from People. Anything filed under their name is still
              filed, and still says their name.
            </p>
            <Link
              to="/people"
              className="mt-4 inline-flex min-h-tap items-center rounded-2 border border-rule-2 px-4 text-body font-medium"
            >
              Back to People
            </Link>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col">
      <BackLink />
      <PersonRecords person={person} name={person?.name ?? 'You'} isYou={isYou} />
    </div>
  )
}

/**
 * The heading, the attention line, the merged list and the footnote.
 *
 * Split from `PersonScreen` so the two list queries mount only once the holder is **known**. Reading
 * them above the not-found branch would fire `?holder=undefined` on every load of a stale link, which
 * is a request that can only return the wrong thing.
 */
function PersonRecords({
  person,
  name,
  isYou,
}: {
  /** `null` on the You screen — there is no directory row behind "mine". */
  person: Person | null
  name: string
  isYou: boolean
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  /** The `?holder=` value: the sentinel for you, the name itself for anybody else. */
  const holder = isYou ? YOU_PERSON_ID : name

  const documents = useDocuments({ holder })
  const things = useThings({ holder })
  const documentRows = documents.data?.data ?? []
  const thingRows = things.data?.data ?? []
  const approx = documents.data?.next_cursor != null || things.data?.next_cursor != null ? '+' : ''

  /**
   * What a row's Copy button reports back — ADR-0027, amended by ADR-0036.
   *
   * This used to carry a revealed set and a per-row toggle, with a note explaining that there was no
   * page-wide "Show" here as there was on the library: a screen scoped to one person is the *worst*
   * place to offer one tap that puts every identifier they hold on screen at once.
   *
   * **That distinction is gone, and in the direction the note wanted.** ADR-0036 deleted the library's
   * page-wide control outright and made masking a device preference, so no screen has a reveal-all and
   * whether this person's numbers are visible is one answer given once on You — rather than a thing
   * each list decides for itself. Reveal, where it applies at all, is per row and lives in `DocumentRow`.
   */
  const numbers: NumberDisplay = {
    onCopied: (label) => setToast(`${label} copied`),
    // Never silent: a clipboard refused by an insecure origin or a denied permission says so, and the
    // number is on screen to select either way.
    onCopyFailed: (label) => setToast(`Couldn’t copy the ${label} — select it on the row instead`),
  }

  const attention = attentionOf(documentRows, isYou)
  const empty = documentRows.length === 0 && thingRows.length === 0

  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-heading text-title font-face-h leading-tight [text-wrap:pretty]">
            {name}
          </h1>
          <p className="mt-1 text-body text-ink-3">
            {personMeta({
              // The **directory's** relation, not the one stored on any single record. ADR-0034 says
              // which wins: the record's relation stays as a fallback and as history, and the person
              // the user maintains is what the screen states.
              relation: person?.relation,
              documentCount: documentRows.length,
              thingCount: thingRows.length,
              approx,
            })}
          </p>
        </div>
        {/* No Edit on the You screen: "mine" is the absence of a holder, so there is no directory row
            to open and nothing a sheet could change. */}
        {person !== null && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>

      {/*
        The attention line, when something filed under them is expiring or already has.

        A summary, not a second ladder: the words come from `expiryOf`, which is the one place a
        document's state is decided (design.md §2). The tone follows the worst state on the page —
        `late` once something has actually expired, `soon` while everything is merely close — because a
        banner that is red for a renewal due in six weeks makes the red mean nothing by the time
        something really has run out.
      */}
      {attention !== null && (
        <Card tone={attention.tone} className="mt-4 p-card">
          <p className="text-row font-medium leading-snug [text-wrap:pretty]">{attention.line}</p>
        </Card>
      )}

      <div className="-mx-gutter mt-4.5 px-gutter">
        {empty ? (
          /*
            An empty state is a sentence in the serif, one instruction, one control (design.md §6) —
            and here the control is the Whose sheet on a document the user already has, which is what
            the instruction names. No button, because there is nothing on this screen to press: you
            file something under somebody from the document, not from the person.
          */
          <div className="py-9 text-center">
            <p className="font-heading text-[1.1875rem] font-face-h leading-snug">
              Nothing filed under {name} yet
            </p>
            <p className="mt-1.5 text-body leading-normal text-ink-3 [text-wrap:pretty]">
              Pick their name at the Whose step, or on any document you’ve already filed.
            </p>
          </div>
        ) : (
          <>
            {/*
              Documents first, then things — the comp's own order, and NOT `mergeRows`.

              The library interleaves by the date that bites first because it is answering *"what
              should I look at next"*. This screen answers *"what is filed under this name"*, where the
              kind is the more useful grouping: the papers, then the objects. Merging them by date here
              would scatter a car's insurance away from the car.
            */}
            {documentRows.map((row) => (
              // `showHolder: false` — every row here is this person's, and their name is the heading.
              <DocumentRow
                key={row.id}
                {...libraryDocumentRowProps(row, numbers, { showHolder: false })}
              />
            ))}
            {thingRows.map((row) => (
              <ThingRow
                key={row.id}
                thing={row}
                showHolder={false}
                className="-mx-gutter border-b border-rule px-gutter"
              />
            ))}
          </>
        )}
      </div>

      <p className="mt-4 pb-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        {isYou
          ? 'Anything without a name against it sits here.'
          : `Filed by you, kept under their name. ${name} has no account and gets no notification.`}
      </p>

      {person !== null && (
        <PersonSheet
          open={editing}
          person={person}
          onClose={() => setEditing(false)}
          onSaved={setToast}
          // Removing somebody from here leaves the screen showing a person who is no longer in the
          // directory, so it goes back to the list. Their records are untouched and still carry the
          // name — which is what the sheet's own note has just said.
          onRemoved={() => void navigate({ to: '/people' })}
        />
      )}

      {toast !== null && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </>
  )
}

function BackLink() {
  return (
    <Link
      to="/people"
      className="-ml-1 inline-flex min-h-tap w-fit items-center gap-[7px] px-1 text-body font-medium text-ink-2"
    >
      <span
        aria-hidden="true"
        className="h-3 w-[7px] rotate-45 border-b-[1.5px] border-l-[1.5px] border-ink-2"
      />
      People
    </Link>
  )
}

/**
 * *"Passport — expires in 6 weeks."* or *"2 of their documents need a look."*
 *
 * `expiryOf` decides what "needs a look" means, which keeps this line and the glyph on the row it
 * refers to from disagreeing — `far` and `none` are excluded because neither is an errand. A thing's
 * warranty is deliberately not counted: cover is a **different ladder** with a different boundary
 * (design.md §2a), and a banner that merged the two would have to pick one vocabulary for both.
 */
function attentionOf(
  documents: readonly Document[],
  isYou: boolean,
): { line: string; tone: 'soon' | 'late' } | null {
  const pressing = documents
    .map((document) => ({ document, expiry: expiryOf(document.expires_on) }))
    .filter(({ expiry }) => expiry.state !== 'far' && expiry.state !== 'none')

  const first = pressing[0]
  if (first === undefined) return null

  const tone = pressing.some(({ expiry }) => expiry.state === 'expired' || expiry.state === 'today')
    ? 'late'
    : 'soon'

  if (pressing.length === 1) {
    return { line: `${first.document.title} — ${first.expiry.label.toLowerCase()}.`, tone }
  }
  return {
    line: `${pressing.length} of ${isYou ? 'your' : 'their'} documents need a look.`,
    tone,
  }
}
