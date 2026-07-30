import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { groupForReading } from './numberFormat'

/**
 * The document's number: masked by default, revealed on request, copyable.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The mask is a display state, NOT a security boundary
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0026 stores the identifier in full, so the whole value is already in this component's props by
 * the time it renders — it arrived on the detail response, and the server does not gate it. Hiding it
 * is about **shoulders near the screen**, not about the server: a caller who can read the document is
 * by definition entitled to its number (invariant: authorization is server-side, and UI gating is not
 * a boundary — so this is deliberately not pretending to be one).
 *
 * What it *is* good for: the number is the most sensitive-looking thing on the screen, it is the field
 * you glance past ninety-nine times for every once you need it, and an Aadhaar number sitting in
 * plain sight in a coffee shop is a real cost with no benefit.
 *
 * ── The label names the real thing ──
 *
 * "Aadhaar number", "Passport number" — not "Identifier". The preset that captured it knows what it
 * is called, and a masked value under a generic label is unreadable twice over.
 *
 * ── Grouped in fours only when it is all digits ──
 *
 * `7294 8103 8109` is how an Aadhaar number is printed and how a person reads one back. A PAN
 * (`ABCDE1234F`) is not grouped, because inserting spaces into an alphanumeric code invents a format
 * the document does not use.
 */

export function IdentifierCard({
  /**
   * The full value. Absent when the document has no number — the card does not render.
   *
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  `undefined` is in this type because the OFFLINE CACHE can produce it. Do not remove it.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *
   * `documentDetailResponseSchema` types this `string | null`, so on paper `undefined` is
   * impossible — and typing it that way **crashed the whole app on a real phone**:
   * *"undefined is not an object (evaluating 'e.length')"*, at the root error boundary, with no way
   * past it but Reload.
   *
   * The route is the persisted Query cache. A document detail fetched by an **older build** is stored
   * in IndexedDB without an `identifier` key, and TanStack Query **rehydrates it without re-running
   * Zod** — validation happens at the fetch boundary, not the restore boundary. So the first render
   * after a deploy hands this component an object the current schema says cannot exist.
   *
   * `CACHE_BUSTER` in `lib/persister.ts` is supposed to prevent that and did not (see the note there).
   * Both are fixed, and this type stays widened anyway: a component that renders a document must
   * survive being handed last week's shape, because the cache is the one input in the app that is
   * older than the code reading it.
   */
  identifier,
  /** The mask, derived server-side. Shown until the user reveals. */
  last4,
  /** What this number is called on the document itself, e.g. "Aadhaar number". */
  label = 'Number',
}: {
  identifier: string | null | undefined
  last4: string | null | undefined
  label?: string
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  // `== null` catches BOTH null and undefined — see the note on the prop. No number, no card: an
  // empty bordered box under "Details" reads as a field that failed to load.
  if (identifier == null || identifier.length === 0) return null

  return (
    <Card tone="sunken" className="mt-3.5 border-rule px-4 py-3.5">
      <p className="text-meta text-ink-3">{label}</p>
      <div className="mt-1.5 flex items-center gap-3">
        {/*
          `break-all` because a 16-character policy number in mono at 19px does not fit 390px minus
          the button, and the alternative is a value that overflows its own card — the "Version 1"
          clipping bug (D37) in a different field.
        */}
        <span
          className={
            revealed
              ? 'selectable min-w-0 flex-1 break-all font-mono text-number font-medium'
              : 'min-w-0 flex-1 font-mono text-number font-medium tracking-mask'
          }
        >
          {revealed ? groupForReading(identifier) : `•••• ${last4 ?? identifier.slice(-4)}`}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => setRevealed(!revealed)}
          /*
            The accessible name says what the control DOES, and names the field it does it to — there
            can be more than one number on a screen once assets arrive, and "Hide" alone would be
            ambiguous between them.
          */
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-3.5">
        <Button
          variant="quiet"
          size="sm"
          className="-ml-2 text-meta text-ink-2"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(identifier)
              setCopied(true)
              // Reverts on its own: a permanently "Copied" button stops being feedback and becomes a
              // label. No timer is cleared on unmount because the state it sets is gone with it.
              setTimeout(() => setCopied(false), 2000)
            } catch {
              // Clipboard access is refused in some contexts (an insecure origin, a denied
              // permission). Revealing the value is the fallback that always works — the user can
              // select it, which is what `selectable` is for. Never a silent no-op.
              setRevealed(true)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {/*
          Says what is true, and the comp's version did not. It reads "Stored in full, encrypted at
          rest, hidden until you ask" — but nothing here is encrypted (invariant 7 and ADR-0009 keep
          application-level encryption for the vault), and this is the one paragraph in the app whose
          whole job is telling the user how their Aadhaar number is handled.
        */}
        <span className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
          Stored in full so you don’t have to find the original. Hidden until you ask.
        </span>
      </div>
    </Card>
  )
}
