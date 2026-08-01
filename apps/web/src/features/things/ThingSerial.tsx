import { SERIAL_LABELS, type ThingKind } from '@life-manager/shared'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { maskedNumber } from '@/lib/mask'
import { useFeel } from '@/lib/useFeel'

/**
 * The thing's serial: shown in full, copyable, masked only if the user asked for that. The sibling of
 * `features/documents/IdentifierCard.tsx`, and it should stay recognisably one — including in this:
 * **one preference governs both**, so a person who hides their Aadhaar number does not have to find a
 * second switch for their IMEI.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Shown by DEFAULT (ADR-0036). The mask is a preference, and never was a boundary.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * things.md §4 rule 7 stores the serial in **full, plaintext**, exactly as ADR-0026 does a document's
 * identifier. So the whole value is already in this component's props by the time it renders: it
 * arrived on the detail response and the server does not gate it. Hiding it is about **shoulders near
 * the screen** — authorization is server-side and UI gating is not a boundary, so this deliberately
 * does not pretend to be one, and a mask that costs a tap on every reading of a serial you keep the
 * app *for* is not worth making unconditional.
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
  /** Decides the label, per rule 8. */
  kind,
}: {
  serial: string | null | undefined
  kind: ThingKind
}) {
  const { feel } = useFeel()
  const [revealed, setRevealed] = useState(false)
  const [copied, setCopied] = useState(false)

  const label = SERIAL_LABELS[kind]

  /**
   * ── A vehicle's registration is NOT masked, and that is a decision rather than an omission ──
   *
   * Handoff 5 draws the plate in full, on the row and here, and the reasoning is that a registration
   * is **painted on the outside of the object**. Masking a number that anyone standing behind the car
   * can read is theatre: it costs the owner a tap on the one value they actually read aloud — to a
   * mechanic, an insurer, a parking attendant — and protects nothing, because the threat the mask
   * addresses is shoulders near the screen and the plate is already public to them.
   *
   * Every other kind is maskable — and, since ADR-0036, only actually masked when `feel.numbers` is
   * `hidden`. An IMEI, a laptop serial and a hallmark are all *inside* the object, which is the case
   * rule 7's mask is for; a plate is not, so it stays exempt at both settings rather than becoming a
   * value the preference could hide. Nothing to toggle means no toggle drawn.
   *
   * This does not change what is stored or what the server returns — the value was always plaintext
   * (things.md §4 rule 7, ADR-0026). It changes only whether this component hides it.
   */
  const isPlate = kind === 'vehicle'
  const masking = feel.numbers === 'hidden' && !isPlate
  const shown = !masking || revealed

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
          shown, so a long value fits.

          The mask is derived here from the full value (`maskedNumber`) rather than read from a server
          field — ADR-0036 dropped `serial_last4`, which was a copy of the last four characters of a
          value sitting in the same response.
        */}
        <span
          className={
            shown
              ? 'selectable min-w-0 flex-1 break-all font-mono text-number font-medium tracking-number'
              : 'min-w-0 flex-1 font-mono text-number font-medium tracking-mask'
          }
        >
          {shown ? serial : maskedNumber(serial)}
        </span>
        {/*
          44px (`--tap-min`), per design.md §6 — `Button`'s `sm` size is narrower, never shorter, so
          "everything tappable clears 44px" holds for a text-only control too.

          The accessible name says what the control DOES and names the field it does it to. There is
          more than one masked value in this app already, and "Hide" alone is ambiguous between them.
        */}
        {/* No Show/Hide on a plate, and none while numbers are shown — there is nothing hidden to
            toggle in either case, and a control whose two states look identical is worse than no
            control. */}
        {masking && (
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setRevealed(!revealed)}
            aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          >
            {revealed ? 'Hide' : 'Show'}
          </Button>
        )}
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
              // permission). Showing the value is the fallback that always works — the user can then
              // select it, which is what `selectable` is for. Never a silent no-op. With numbers
              // shown it is already selectable, so this only has work to do while the mask is on.
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
          Stored in full so you don’t have to go and read it off the thing.{' '}
          {masking
            ? 'Hidden until you ask, because you asked for that.'
            : 'Shown because it’s yours.'}
        </span>
      </div>
    </Card>
  )
}
