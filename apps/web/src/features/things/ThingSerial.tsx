import { SERIAL_LABELS, type ThingKind } from '@life-manager/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

/**
 * The thing's serial: masked by default, revealed on request, copyable. The sibling of
 * `features/documents/IdentifierCard.tsx`, and it should stay recognisably one.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The mask is a display state, NOT a security boundary — and nothing here is encrypted.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * things.md §4 rule 7 stores the serial in **full, plaintext**, exactly as ADR-0026 does a document's
 * identifier. So the whole value is already in this component's props by the time it renders: it
 * arrived on the detail response and the server does not gate it. Hiding it is about **shoulders near
 * the screen** — authorization is server-side and UI gating is not a boundary, so this deliberately
 * does not pretend to be one.
 *
 * And **no copy in this file may say "encrypted"**. Invariant 7 and ADR-0009 reserve
 * application-level encryption for the vault; this is not the vault. That is debt **D44**, and the
 * comp's own version of the document card said "encrypted at rest" — which is the sentence
 * `IdentifierCard` refused and this one refuses for the same reason.
 *
 * ── The label is always visible, and it is not "Serial" ──
 *
 * things.md §4 rule 8: what the value is *called* depends on the kind. IMEI for a phone, `Registration`
 * for a vehicle, `Hallmark` for a valuable, `Order number` for furniture. One column holds all four
 * without ambiguity **only** because the label rides along — an unlabelled twelve-character string is a
 * string nobody can identify, and this is the same argument ADR-0027 makes for a document's number
 * label.
 *
 * ── Not grouped in fours, where a document's number sometimes is ──
 *
 * `IdentifierCard` groups an all-digit value (`7294 8103 8109`) because that is how an Aadhaar number
 * is printed and read back. A serial has no such canonical form: an IMEI is printed as fifteen
 * unbroken digits and a registration is `KA 01 AB 1234` or `22 BH 1234 AA` — two live formats whose
 * spacing is part of the value (rule 9). Inserting spaces would invent a format the object does not
 * use, so the stored value is shown verbatim.
 */
export function ThingSerial({
  /**
   * The full value. Absent when the thing has no serial — the card does not render.
   *
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  `undefined` is in this type because the OFFLINE CACHE can produce it. Do not remove it.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *
   * `thingSchema` types this `string | null`, so on paper `undefined` is impossible. Typing it that way
   * on `IdentifierCard` **crashed the whole app on a real phone** — *"undefined is not an object
   * (evaluating 'e.length')"*, at the root error boundary, with no way past it but Reload.
   *
   * The route is the persisted Query cache, which holds `'things'` (see `lib/persister.ts`). A detail
   * response fetched by an **older build** is stored in IndexedDB without whichever key the current
   * build expects, and TanStack Query **rehydrates it without re-running Zod** — validation happens at
   * the fetch boundary, not the restore boundary. Debt **D46**. `CACHE_BUSTER` is supposed to prevent
   * that and once did not, so a component that renders a record must survive being handed last week's
   * shape: the cache is the one input in the app that is older than the code reading it.
   */
  serial,
  /** The mask, derived server-side (`serial_last4`). Shown until the user reveals. */
  last4,
  /** Decides the label, per rule 8. */
  kind,
}: {
  serial: string | null | undefined
  last4: string | null | undefined
  kind: ThingKind
}) {
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const label = SERIAL_LABELS[kind]

  // `== null` catches BOTH null and undefined — see the note on the prop. No serial, no card: an empty
  // bordered box under the facts reads as a field that failed to load.
  if (serial == null || serial.length === 0) return null

  return (
    <Card tone="sunken" className="mt-3.5 border-rule px-4 py-3.5">
      <p className="text-meta text-ink-3">{label}</p>
      <div className="mt-1.5 flex items-center gap-3">
        {/*
          `break-all` for the same reason as the document card: a 17-character VIN in mono at 19px does
          not fit 390px minus the button, and the alternative is a value overflowing its own card — the
          "Version 1" clipping bug (D37) in a different field.

          Tracking is wide while masked, so `•••• 4471` reads as a deliberate format, and tight when
          revealed, so a long value fits.
        */}
        <span
          className={
            revealed
              ? 'selectable min-w-0 flex-1 break-all font-mono text-number font-medium tracking-number'
              : 'min-w-0 flex-1 font-mono text-number font-medium tracking-mask'
          }
        >
          {revealed ? serial : `•••• ${last4 ?? serial.slice(-4)}`}
        </span>
        {/*
          44px (`--tap-min`), per design.md §6 — `Button`'s `sm` size is narrower, never shorter, so
          "everything tappable clears 44px" holds for a text-only control too.

          The accessible name says what the control DOES and names the field it does it to. There is
          more than one masked value in this app already, and "Hide" alone is ambiguous between them.
        */}
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => setRevealed(!revealed)}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
        >
          {revealed ? 'Hide' : 'Show'}
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-3.5">
        <Button
          variant="quiet"
          size="sm"
          className="-ml-2 text-meta text-ink-2"
          aria-label={`Copy ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(serial)
              setCopied(true)
              // Reverts on its own: a permanently "Copied" button stops being feedback and becomes a
              // label. No timer is cleared on unmount because the state it sets is gone with it.
              setTimeout(() => setCopied(false), 2000)
            } catch {
              // Clipboard access is refused in some contexts (an insecure origin, a denied
              // permission). Revealing is the fallback that always works — the user can then select
              // the value, which is what `selectable` is for. Never a silent no-op.
              setRevealed(true)
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {/*
          Says what is true. `IdentifierCard`'s equivalent sentence is the precedent, and the trap it
          avoids is naming encryption that does not exist (D44). This one is about the *place* the
          number otherwise lives: behind the machine, under the bonnet, on a label you have to move
          furniture to read.
        */}
        <span className="text-meta leading-snug text-ink-3 [text-wrap:pretty]">
          Stored in full so you don’t have to go and read it off the thing. Hidden until you ask.
        </span>
      </div>
    </Card>
  )
}
