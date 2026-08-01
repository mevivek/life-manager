import { RELATION_SUGGESTIONS } from '@life-manager/shared'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * *"How they're related"* — **the one relation field**, wherever a relation is typed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Three screens ask for a relation. Only one of them used to offer the answers.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `PersonSheet` shipped with the comp's eight suggestion chips. `CaptureSheet`'s Whose step and
 * `DocumentForm` shipped with a bare `<Input placeholder="Wife">` and nothing else — so whether the
 * app offered you a relation depended entirely on which door you came in through, and the two doors
 * a user actually meets while *filing something* were the two that offered nothing. Reported by the
 * maintainer, and it is the same drift as the row builder earlier in this session: one idea, three
 * implementations, two of them stubs.
 *
 * ── Chips, not a `<select>` ──
 *
 * The request was for "a premade dropdown". This is that list, drawn as a visible row, because
 * [design.md §6](../../../../docs/conventions/design.md) refuses dropdowns and states the reason a
 * `<select>` would fail here: *a menu that must be opened to reveal a choice that would fit on screen
 * costs a tap and hides the options.* All eight fit on a 390px screen with room to spare — measured,
 * not assumed — so a select would add a tap, hide the answers behind it, and hand the styling to the
 * platform. It would also fight the field's other half: the value is **free text**, and a `<select>`
 * cannot express "Wife, or anything else you like" without an `Other…` escape hatch that is worse
 * than the text box already here.
 *
 * If a closed list is ever genuinely wanted, that is a change to `RELATION_SUGGESTIONS`' contract —
 * it is documented in `packages/shared/src/people.ts` as *suggestions, never an enum on the wire* —
 * and it needs the design.md §6 rule superseded rather than sidestepped.
 */
export function RelationField({
  id,
  value,
  onChange,
  /** `Relation · optional` in a sheet; `How they're related` beside a name field. */
  label = 'Relation · optional',
  className,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  label?: string
  className?: string
}) {
  /**
   * The text field's own accessible name, derived from the legend rather than fixed at "Relation".
   *
   * The legend names the **group** — chips and field together — and a screen reader announces it
   * before each control inside. But the field also needs a name of its own, and it should be the same
   * human phrase the sighted user reads above it: on a document, *"How they're related"*. Hardcoding
   * "Relation" made the two disagree, which is how `documents.test.tsx` caught this.
   *
   * The ` · optional` suffix is dropped, because it qualifies the group rather than naming the field —
   * "Relation · optional, edit text" reads as though *optional* were part of what to type.
   */
  const fieldLabel = label.split(' · ')[0] ?? label

  return (
    /*
      A `<fieldset>` with a `<legend>`, not a `div role="group"` — design.md §6. The legend is
      announced before each pill, so a screen reader hears "Relation, Wife" rather than a bare "Wife"
      with no idea what it sets.
    */
    <fieldset className={cn('flex flex-col gap-2 border-0 p-0', className)}>
      <legend className="float-left font-mono text-label uppercase tracking-label text-ink-3">
        {label}
      </legend>
      {/*
        `RELATION_SUGGESTIONS` is imported, never re-typed. The shared module is explicit that these
        are **suggestions and never an enum on the wire** — the field takes any string, because
        "Flatmate" and "Mother-in-law" are real answers and a closed list would make the app argue
        with its user about their own household. The text field below is that promise kept: the chips
        are a shortcut into it, not a gate in front of it.
      */}
      <div className="clear-both flex flex-wrap gap-1.5 pt-0.5">
        {RELATION_SUGGESTIONS.map((suggestion) => (
          <Chip
            key={suggestion}
            size="sm"
            selected={value === suggestion}
            // Tapping the lit chip clears it, so a relation chosen by mistake does not need the text
            // field to undo.
            onClick={() => onChange(value === suggestion ? '' : suggestion)}
          >
            {suggestion}
          </Chip>
        ))}
      </div>
      {/*
        Every example in the placeholder is deliberately NOT one of the chips. The sentence's whole
        job is "the list above is a shortcut, not the choices" — naming a relation that is already a
        pill two rows up says the opposite, and the first 390px render caught it doing exactly that
        with *Mother*. `RelationField.test.tsx` asserts the disjointness so a later edit cannot
        quietly reintroduce it.
      */}
      <Input
        id={id}
        aria-label={fieldLabel}
        value={value}
        placeholder="Or type it — Flatmate, Sister, Business"
        onChange={(event) => onChange(event.target.value)}
      />
    </fieldset>
  )
}
