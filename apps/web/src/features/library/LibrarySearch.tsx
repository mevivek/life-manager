import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { LibraryScope } from './scope'

/**
 * The library's search — **a toggle, not a permanent field**.
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * ── Why it folds away, when the archive's was always on screen ──
 *
 * The merged header has to carry a title, a count, a scope switch and (under Documents) a filter row.
 * A 48px field on top of that is 48px of chrome above the first result on a 390px screen, permanently,
 * for a control most visits do not use — you open this tab to *look at* what you own at least as often
 * as to find one record.
 *
 * Folding it behind a 44px button is what buys the scope pills their row. The trade is one tap to
 * search; the alternative was one scroll to see anything.
 *
 * **The button reports state, so folding it does not hide an active search.** With a query set it
 * stays tinted (`--sunken`) and inked even while closed, and the summary line below stays drawn — the
 * failure mode this has to avoid is a user seeing a short list, not remembering they searched, and
 * concluding records are missing.
 */

const PLACEHOLDERS: Record<LibraryScope, string> = {
  all: 'Documents, things, anything filed',
  documents: 'Title, issuer, notes, tag',
  things: 'Name, make, model, serial',
}

const LABELS: Record<LibraryScope, string> = {
  all: 'Search everything',
  documents: 'Search documents',
  things: 'Search things',
}

/** The magnifier — geometry rather than an icon, like every other glyph in the app. */
export function SearchToggle({
  open,
  active,
  scope,
  onClick,
}: {
  open: boolean
  /** A query is set. Keeps the button lit while the field is folded away. */
  active: boolean
  scope: LibraryScope
  onClick: () => void
}) {
  const lit = open || active

  return (
    <Button
      variant="quiet"
      onClick={onClick}
      aria-expanded={open}
      aria-label={open ? 'Close search' : LABELS[scope]}
      className={cn(
        'min-h-tap min-w-11 shrink-0 rounded-2 px-0',
        lit ? 'bg-sunken text-ink' : 'text-ink-2',
      )}
    >
      <span aria-hidden="true" className="relative block size-[17px]">
        <span className="absolute top-0 left-0 box-border block size-[13px] rounded-full border-[1.8px] border-current" />
        <span className="absolute right-0 bottom-px block h-[1.8px] w-[7px] origin-right rotate-45 rounded-[1px] bg-current" />
      </span>
    </Button>
  )
}

/**
 * The field itself, plus Close.
 *
 * `autoFocus` because the only way to get here is to have tapped the magnifier, which is an
 * unambiguous statement of intent — this is the one case where stealing focus is what the user asked
 * for. The keyboard comes up on the same tap that opens the field, which is the whole point of
 * spending a tap on the toggle.
 */
export function LibrarySearchField({
  value,
  scope,
  onChange,
  onClose,
}: {
  value: string
  scope: LibraryScope
  onChange: (next: string) => void
  onClose: () => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={PLACEHOLDERS[scope]}
        aria-label={LABELS[scope]}
        autoFocus
        className="h-12 min-w-0 flex-1 border-ink"
      />
      {/*
        "Close", not an ✕. The control does two things — folds the field and clears the query — and a
        cross reads as clearing the text only. Naming it costs 40px of a row that has them.
      */}
      <Button variant="quiet" onClick={onClose} className="shrink-0 px-2 text-row text-ink-2">
        Close
      </Button>
    </div>
  )
}

/**
 * The line under the field: what the query matched, counted per kind.
 *
 * It answers the question a merged list makes newly askable — *"is this everything, or did the other
 * kind just not match?"* — which on two separate screens the user answered by switching screens.
 *
 * Counts come from the loaded pages, so past one page they are a floor. `complete` says so rather
 * than letting the number read as a total (D33's rule: a count you assert must be one you can stand
 * behind).
 */
export function SearchSummary({
  query,
  documents,
  things,
  complete,
}: {
  query: string
  documents: number
  things: number
  complete: boolean
}) {
  if (query.trim() === '') {
    return (
      <p className="mt-2.5 text-meta leading-normal text-ink-3 [text-wrap:pretty]">
        Searches across everything you’ve filed.
      </p>
    )
  }

  const parts = [
    `${documents}${complete ? '' : '+'} ${documents === 1 ? 'document' : 'documents'}`,
    `${things}${complete ? '' : '+'} ${things === 1 ? 'thing' : 'things'}`,
  ]

  return (
    <p aria-live="polite" className="mt-2.5 text-meta leading-normal text-ink-3 [text-wrap:pretty]">
      {`${parts.join(' · ')} match “${query.trim()}”`}
    </p>
  )
}
