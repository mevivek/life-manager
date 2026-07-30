import type { LinkedDocument } from '@life-manager/shared'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/label'
import {
  ExpiryGlyph,
  ExpiryWords,
  expiryAccessibleName,
  expiryOf,
} from '@/features/documents/ExpiryStatus'

/**
 * *"Its documents"* — the other half of the link. things.md §7, comp lines 802–826.
 *
 * The document side draws *"Belongs to"*; this side draws the collection. **One endpoint sets it**
 * (`PATCH /documents/:id { thing_id }`), because that is where the column lives (things.md §5).
 *
 * ── Why these rows are not `DocumentRow` ──
 *
 * `linkedDocumentSchema` is a **summary** — id, title, doc_type, issuer, expires_on — and that is a
 * deliberate contract decision, not an omission. Nesting `documentSchema` here would put every linked
 * document's full plaintext `identifier` on a Things response, a second route to the same data for no
 * gain: this screen draws a title, a status and an issuer, and tapping a row navigates to the document
 * itself. ADR-0027's argument for the full number on a *document* list does not transfer, because
 * nobody stands at a counter reading a number off a thing's detail screen.
 *
 * So `DocumentRow` cannot take one of these, and widening its prop to a union would make the archive's
 * row responsible for a shape the archive never receives. These rows draw the same three things in the
 * same type, from the one expiry ladder (`ExpiryStatus`), and that is where the consistency has to come
 * from.
 */
export function ThingDocuments({
  documents,
  /**
   * Opens capture with this thing prefilled. Supplied by the route, which owns the Add sheet — the same
   * reasoning as `PapersChecklist`'s `onCapture`.
   */
  onFile,
  today,
}: {
  documents: LinkedDocument[]
  onFile: () => void
  today?: Date
}) {
  return (
    <section className="mt-6">
      <Eyebrow className="block pb-1">Its documents</Eyebrow>

      {documents.length > 0 ? (
        <ul className="list-none">
          {documents.map((document) => (
            <li key={document.id}>
              <DocumentLinkRow document={document} today={today} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="pt-2.5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
          {/*
            The comp's sentence, and it earns its place by naming which document to reach for. "Nothing
            here yet" would be the version that says only what the reader can already see — design.md
            §7: an empty section gets something true said in the gap, not a restatement of the absence.
          */}
          Nothing filed against this yet. A receipt or a warranty card is the useful one.
        </p>
      )}

      {/*
        Dashed — an *invitation* to add something optional, not a step the user is expected to complete
        (the `dashed` variant's own note). A solid button here would compete with the one emphatic
        control the app allows itself.
      */}
      <Button variant="dashed" className="mt-3 w-full" onClick={onFile}>
        File a document against this
      </Button>
    </section>
  )
}

/**
 * One linked document, as a row.
 *
 * The accessible name is `expiryAccessibleName`'s — the glyph is `aria-hidden`, so the status only
 * exists for a screen reader here, and it carries **both** the relative distance and the absolute date
 * (design.md §9). The chevron is decorative: the row is a real `<Link>`, so focus and the global focus
 * ring come for free.
 */
function DocumentLinkRow({ document, today }: { document: LinkedDocument; today?: Date }) {
  const expiry = expiryOf(document.expires_on, today)

  /**
   * `Financial · Aviva`, or nothing at all.
   *
   * `doc_type` is omitted when it is `other`, exactly as `DocumentRow` does it: `other` is the schema
   * default, so "Other" would appear on every document whose type the user never set, and it says less
   * than nothing. Unlike `DocumentRow` there is no "Title only" fallback — the thing's own name is
   * already the context, so an empty gloss reads as brevity rather than as data that failed to load.
   */
  const meta = [
    document.doc_type === 'other' ? null : capitalise(document.doc_type),
    document.issuer,
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ')

  return (
    <Link
      to="/documents/$documentId"
      params={{ documentId: document.id }}
      aria-label={expiryAccessibleName(document.title, document.expires_on, today)}
      className="flex min-h-row items-center gap-3.5 border-b border-rule py-row-pad active:bg-sunken hover:bg-sunken"
    >
      {/* A fixed 14px column so titles line up whichever glyph a row carries — the gauge is 14px wide
          and the dash is 2px tall, and without the column the text shifts per state. */}
      <span className="flex w-3.5 shrink-0 items-center justify-center">
        <ExpiryGlyph state={expiry.state} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-row font-medium leading-snug">{document.title}</span>
        {/*
          The status never shrinks; the meta is what truncates. `whitespace-nowrap` alone does not do
          it — a flex item shrinks below its content — which is how a long issuer once squeezed
          "EXPIRED 7 WEEKS AGO" out of its own box instead of shortening the issuer beside it.
        */}
        <span className="mt-0.5 flex items-baseline gap-[7px]">
          <ExpiryWords expiry={expiry} className="shrink-0 whitespace-nowrap" />
          {meta !== '' && (
            <span className="min-w-0 flex-1 truncate text-meta text-ink-3">{meta}</span>
          )}
        </span>
      </span>

      <span
        aria-hidden="true"
        className="h-3 w-[7px] shrink-0 rotate-45 border-t-[1.5px] border-r-[1.5px] border-rule-2"
      />
    </Link>
  )
}

function capitalise(value: string): string {
  return value.length === 0 ? value : value[0]?.toUpperCase() + value.slice(1)
}
