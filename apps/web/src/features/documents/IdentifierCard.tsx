import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { maskedNumber } from '@/lib/mask'
import { useFeel } from '@/lib/useFeel'
import { groupForReading } from './numberFormat'

/**
 * The document's number: shown in full, copyable — and masked only if the user asked for that.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Shown by DEFAULT. The mask is a preference, and it never was a security boundary.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * [ADR-0036](../../../../docs/decisions/0036-numbers-shown-by-default.md). This card used to mask
 * unconditionally and hand back the value on a tap. ADR-0026 stores the identifier in full and
 * ADR-0027 returns it on every response, so the whole value is already in this component's props by
 * the time it renders — the server does not gate it, and a caller who can read the document is by
 * definition entitled to its number (invariant: authorization is server-side, UI gating is not a
 * boundary). A reveal step therefore cost a tap on the one field people open this screen to read,
 * and bought nothing the payload had not already given away.
 *
 * What masking *is* good for is **shoulders near the screen** — a real cost in a coffee shop, none at
 * a kitchen table. That is the shape of a preference, so it is one: `feel.numbers`, set on the You
 * screen, device-scoped, off by default, and applied to a thing's serial in exactly the same way
 * (`features/things/ThingSerial.tsx`).
 *
 * ── The label names the real thing ──
 *
 * "Aadhaar number", "Passport number" — not "Identifier". The preset that captured it knows what it
 * is called, and a value under a generic label is harder to place than it needs to be.
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
  /** What this number is called on the document itself, e.g. "Aadhaar number". */
  label = 'Number',
}: {
  identifier: string | null | undefined
  label?: string
}) {
  const { feel } = useFeel()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  // `== null` catches BOTH null and undefined — see the note on the prop. No number, no card: an
  // empty bordered box under "Details" reads as a field that failed to load.
  if (identifier == null || identifier.length === 0) return null

  const masking = feel.numbers === 'hidden'
  const shown = !masking || revealed

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
            shown
              ? 'selectable min-w-0 flex-1 break-all font-mono text-number font-medium'
              : 'min-w-0 flex-1 font-mono text-number font-medium tracking-mask'
          }
        >
          {shown ? groupForReading(identifier) : maskedNumber(identifier)}
        </span>
        {/*
          No control at all while numbers are shown — which is the default. A button whose two states
          look identical is worse than no button, and the Hide half would be offering to undo a
          preference from a screen that does not own it.

          When masking IS on, the accessible name says what the control does and names the field it
          does it to: there can be more than one number on a screen once assets arrive, and "Hide"
          alone would be ambiguous between them.
        */}
        {masking && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setRevealed(!revealed)}
            aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          >
            {revealed ? 'Hide' : 'Reveal'}
          </Button>
        )}
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
              // permission). Showing the value is the fallback that always works — the user can
              // select it, which is what `selectable` is for. Never a silent no-op. With numbers
              // shown it is already on screen and selectable, so this only has work to do while the
              // mask is on.
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

          The second sentence tracks the preference rather than asserting one behaviour, because it
          used to end "Hidden until you ask" and that is now true for exactly half of users.
        */}
        <span className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
          Stored in full so you don’t have to find the original.{' '}
          {masking
            ? 'Hidden until you ask, because you asked for that.'
            : 'Shown because it’s yours.'}
        </span>
      </div>
    </Card>
  )
}
