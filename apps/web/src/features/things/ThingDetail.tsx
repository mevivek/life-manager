import { KIND_LABELS } from '@life-manager/shared'
import { Link, useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError } from '@/lib/api'
import { ClaimPack } from './ClaimPack'
import { DeleteThing } from './DeleteThing'
import { OwnershipBanner, OwnershipPanel } from './OwnershipPanel'
import { PapersChecklist } from './PapersChecklist'
import { ServiceHistory } from './ServiceHistory'
import { ThingCoverCard } from './ThingCoverCard'
import { ThingDocuments } from './ThingDocuments'
import { ThingFacts } from './ThingFacts'
import { ThingHero, ThingPhotos } from './ThingPhotos'
import { ThingSerial } from './ThingSerial'
import { useThing } from './useThings'

/**
 * Thing detail — the whole screen. things.md §7, ADR-0029, comp lines 689–897.
 *
 * The sibling of `documents.$documentId.tsx`, ordered on the same principle: **what a person came here
 * to find out**, loudest first. The order is things.md §7's, and each step answers a different question
 * rather than naming a category of data:
 *
 *  1. **Is it even with me?** — the ownership banner, above everything, because it changes how the rest
 *     of the screen should be read.
 *  2. **Is it still covered, and how old is it?** — the cover card, tinted with its own state.
 *  3. **When was it last looked after?** — the service cycle and its log.
 *  4. **The facts, then the serial** — bought, paid, kept, and the number on the label.
 *  5. **Where are its papers?** — the vehicle 2×2, then everything filed against it.
 *  6. **The pack, the handover, the delete** — three quiet things at the foot, in rising finality.
 *
 * Every section is its own component, so the running order above is legible in one screen and no
 * section's internals compete with it. The two things this file genuinely owns are the **header** (name,
 * kind, holder) and the three states — pending, failed, loaded.
 *
 * ── Why the screen lives here and not in the route file ──
 *
 * `routes/_authed/things.$thingId.tsx` is a ten-line shell that reads the param and pulls
 * `openAddAgainst` out of `useAddSheet()`. That split is what makes this testable: a route module is
 * bound to the generated route tree and to the `AddSheetProvider` above it, and `thing-detail.test.tsx`
 * needs neither — it needs the sparse state, the four cover states and the ownership writes, which are
 * all *here*. Opening capture arrives as a prop for the same reason `PapersChecklist` takes one.
 *
 * ── No `flex-1` and no `mt-auto`, on purpose ──
 *
 * design.md §7's rule applies to a page with a **foot** — prose pinned under content that can run short.
 * This screen has no footer: it ends with the delete control, which is where it should end, and
 * stretching it would push "Delete this thing" to the bottom of every viewport. Even the sparsest real
 * record (a name and nothing else, business rule 1) still draws a cover card, four fact rows, the claim
 * pack, the handover control and the delete — so there is no void here to relocate.
 *
 * ── The error state is no longer the default view ──
 *
 * This note used to say the screen renders its error branch in production, because there was no Things
 * API. There is now (things.md §10), so `NotHere` is a real error state again rather than the everyday
 * one. Its copy is still written to be honest about a request that failed rather than to report a
 * deleted record, which is the right wording either way.
 */
export function ThingDetail({
  thingId,
  /**
   * Opens capture with this thing attached. `AddSheetProvider`'s `openAddAgainst`, passed straight
   * through by the route — the signature is deliberately identical so there is nothing to translate and
   * nothing to get wrong between them.
   *
   * `forThing` is what makes the sheet drop its type step (ADR-0030's five-step variant), and `preset`
   * is what makes it arrive already knowing the issuer and the number's label.
   */
  onFileAgainst,
  /** Injectable so every relative assertion is arithmetic rather than a race with the clock. */
  today,
}: {
  thingId: string
  onFileAgainst: (intent: {
    thing: { id: string; name: string }
    preset?: string
    title?: string
  }) => void
  today?: Date
}) {
  const navigate = useNavigate()
  const thing = useThing(thingId)

  if (thing.isPending) {
    return (
      <div role="status" aria-label="Loading thing" aria-live="polite">
        <BackLink />
        {/* First paint only — design.md §6. A refetch keeps the stale record and dims nothing;
            replacing real content with shimmer is how a working app looks broken. */}
        <Skeleton className="mt-2 h-7 w-48" />
        <Skeleton className="mt-2 h-3 w-32 rounded-1" />
        <Skeleton className="mt-4 h-28 w-full rounded-3" />
        <Skeleton className="mt-5 h-40 w-full rounded-3" />
      </div>
    )
  }

  if (thing.isError) {
    return <NotHere error={thing.error} onRetry={() => void thing.refetch()} />
  }

  const detail = thing.data

  /**
   * `Vehicle · Volkswagen · Golf` — the kind, then the make and model, whichever exist.
   *
   * `KIND_LABELS` rather than the raw enum value: `av` is a column value and "TV & audio" is the word,
   * and the contract carries both precisely because one is not the other. `other` maps to "Thing",
   * which is the right thing to say for a kind nobody chose — it is absent from `CAPTURE_KINDS` on
   * purpose, so it only ever arrives as a default.
   */
  const sub = [KIND_LABELS[detail.kind], detail.brand, detail.model]
    .filter((part) => part !== null && part !== '')
    .join(' · ')

  return (
    <div>
      <BackLink />

      {/*
        The hero photo, above the name — comp 697. A record whose subject is a physical object opens
        with a picture of it; when there is no picture yet, the frame is the control that takes one.
        See `ThingPhotos.tsx` for why this is the one `<img>` in the app minted on render.
      */}
      <ThingHero thingId={detail.id} name={detail.name} photos={detail.photos} />

      <div className="pt-3.5">
        {/*
          `text-[1.6875rem]` (27px) is copied verbatim from `documents.$documentId.tsx`, and the
          arbitrary value is the point: a detail screen's title sits between `--t-title` (24px) and
          `--t-display` (30px), which is a step the scale does not have. It is not promoted to a token
          because a token would then need declaring in `utils.ts`'s `TEXT_SIZES` (design.md §1's
          two-file trap) for a value used on exactly two screens — and the two screens must match, which
          the shared literal makes obvious and a near-miss token would not.

          `font-heading` / `font-face-h` / `tracking-heading` rather than `font-serif`, so the *Headings*
          feel preference reaches it (design.md §12).
        */}
        <h1 className="font-heading text-[1.6875rem] font-face-h leading-[1.18] tracking-heading">
          {detail.name}
        </h1>
        <p className="mt-1 text-meta text-ink-3">{sub}</p>

        {/*
          The holder, as a hairline pill — and **only when there is one**.

          things.md §4 rule 6: a holder is a label, never a permission, and `null` means "mine" and is
          drawn as *absence*. There is no "Me" badge anywhere in this app and this must not become the
          first one. The relation rides along when it exists, because "Priya · Wife" is what
          distinguishes two people who share a first name.
        */}
        {detail.holder != null && detail.holder !== '' && (
          <p className="mt-2.5 inline-flex min-h-[1.875rem] items-center rounded-pill border border-rule-2 px-2.5 text-meta font-medium text-ink-2">
            Filed under {detail.holder}
            {detail.relation != null && detail.relation !== '' && ` · ${detail.relation}`}
          </p>
        )}
      </div>

      {/* ── 1. Is it with me? ── */}
      <OwnershipBanner thing={detail} />

      {/* ── 2. Cover, age, and the service tag ── */}
      <ThingCoverCard thing={detail} today={today} className="mt-4" />

      {/* ── 3. The cycle and its log ── */}
      <ServiceHistory thingId={thingId} thing={detail} services={detail.services} today={today} />

      {/* ── 4. The facts, then the number on the label ── */}
      <ThingFacts thing={detail} />
      <ThingSerial serial={detail.serial} last4={detail.serial_last4} kind={detail.kind} />

      {/* ── 5. Its papers ── */}
      <PapersChecklist
        thing={detail}
        documents={detail.documents}
        today={today}
        /*
          things.md §7's shortcut, wired end to end: the slot's preset and its suggested title go with
          the thing, and `forThing`'s presence is what drops capture's type step. An explicit `title`
          beats the preset's own name inside the wizard, so "Insurance — Golf" survives rather than
          being overwritten by "Vehicle insurance".
        */
        onCapture={(slot) =>
          onFileAgainst({
            thing: { id: detail.id, name: detail.name },
            preset: slot.preset,
            title: slot.suggestedTitle,
          })
        }
      />
      {/* The dashed invitation: the thing, and nothing else. There is no slot to infer a type from, and
          guessing one from the thing's kind would prefill an answer the user has not given. */}
      <ThingDocuments
        documents={detail.documents}
        onFile={() => onFileAgainst({ thing: { id: detail.id, name: detail.name } })}
        today={today}
      />

      <ThingPhotos thingId={detail.id} name={detail.name} photos={detail.photos} />

      {/* ── 6. The pack, the handover, the delete ── */}
      <ClaimPack thing={detail} />
      <OwnershipPanel thing={detail} />
      {/*
        No toast on success: this navigates away immediately, so a toast mounted here would unmount
        before it could be read. (`documents.$documentId.tsx` sets one and then navigates, which is why
        it never appears there either — not repeated.)
      */}
      <DeleteThing thing={detail} onDeleted={() => void navigate({ to: '/things' })} />
    </div>
  )
}

/**
 * Back to the collection.
 *
 * Always "Things" rather than remembering where the user came from. The comp tracks an origin screen and
 * relabels the link, but a back link whose text changes between visits is harder to learn than one that
 * always names the same place — and the tab bar already offers Now. A real `<Link>` rather than browser
 * back, because a deep link from a notification has no history to return to.
 */
function BackLink() {
  return (
    <Link
      to="/things"
      className="-ml-1 inline-flex min-h-tap items-center gap-[7px] px-1 text-body font-medium text-ink-2"
    >
      <span
        aria-hidden="true"
        className="h-3 w-[7px] rotate-45 border-b-[1.5px] border-l-[1.5px] border-ink-2"
      />
      Things
    </Link>
  )
}

/**
 * The one failure screen, and it has to cover three causes it **cannot tell apart**.
 *
 * A 404 here is indistinguishable from "belongs to another space" — deliberately, per invariant 4: a 403
 * would confirm the record exists. Today it is also indistinguishable from a third thing, which is that
 * `/api/v1/things/:id` **is not a route yet** (things.md §10): Fastify answers 404 for an unregistered
 * path exactly as it does for a record that is not there.
 *
 * So the copy names all three possibilities in one sentence, speculates about none of them, and the last
 * line is there to stop the reader doing it either. "This thing was deleted" would be the app
 * confidently reporting the cause that is currently the *least* likely of the three.
 *
 * Anything that is **not** a 404 — the API down, a contract mismatch, no connection — gets the server's
 * own sentence and a Retry that genuinely refetches. Never flattened into "not found", never swallowed
 * (conventions/code.md §6).
 */
function NotHere({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const notFound = error instanceof ApiError && error.status === 404

  return (
    <div>
      <BackLink />
      <div className="px-8 py-14 text-center">
        {/*
          A dashed square — the same "an absence to be filled" glyph vocabulary as the no-scan marker and
          the unfiled paper slot. `aria-hidden`: the words below are the fact.
        */}
        <div
          aria-hidden="true"
          className="mx-auto mb-4 h-[19px] w-[19px] rounded-1 border-[1.5px] border-dashed border-ink-3"
        />
        {/* 20px — the same step `documents.$documentId.tsx` uses for its own not-found headline, and
            arbitrary for the same reason: an empty state's sentence is a size between `--t-head` and
            `--t-title` that only these two screens need. */}
        <p className="font-heading text-[1.25rem] font-face-h leading-snug">
          {notFound ? 'This thing isn’t here' : 'Couldn’t load this thing'}
        </p>
        <p className="mt-2 text-body leading-relaxed text-ink-3 [text-wrap:pretty]">
          {notFound
            ? 'It may have been deleted, the link may be wrong, or Things isn’t switched on yet. Nothing else to read into it.'
            : error instanceof Error
              ? error.message
              : 'Something went wrong reaching the server.'}
        </p>

        {notFound ? (
          <Link
            to="/things"
            className="mt-4 inline-flex min-h-tap items-center rounded-2 border border-rule-2 px-4 text-body font-medium"
          >
            Back to things
          </Link>
        ) : (
          <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}
