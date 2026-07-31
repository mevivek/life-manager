import type { Document } from '@life-manager/shared'
import type { DocumentRowProps } from './DocumentRow'
import { groupForReading } from './numberFormat'
import { numberLabelFor } from './presets'

/**
 * The **one** place a `Document` becomes `DocumentRow` props.
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A row must not change shape when the scope pills change.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * It did, and that was a bug the maintainer caught by looking at the screen. The library's `All`
 * scope built its rows inline while the `Documents` scope built them inside `DocumentList`, so the
 * same passport rendered with a **52px glyph column and no number controls** in one and a **14px
 * column with Copy and Show** in the other. Tapping a filter appeared to redraw the row.
 *
 * The comp says why this happens and how to stop it, in a comment on its own normalisers: *"Every
 * list — All, Documents, Things — renders the same row. These two normalizers are the only place a
 * document or a thing becomes row data, so the lists can't drift apart again."* This function is that
 * for documents; `ThingRow` already needed no equivalent, because it takes a `Thing` and nothing else.
 *
 * So: **do not construct `DocumentRow` props anywhere else in the library.** Adding a second call
 * site is how the two lists drift apart a second time.
 */

/** The revealed-number state the archive's header toggle and the per-row buttons share (ADR-0027). */
export type NumberDisplay = {
  /** Ids the user has opened individually. A page-wide toggle is `revealAll`, not a filled set. */
  revealedIds: ReadonlySet<string>
  revealAll: boolean
  onToggle: (documentId: string) => void
  /** Called with the number's label after a successful copy, so the page can say so. */
  onCopied: (label: string) => void
}

/**
 * The number line and its Copy / Show controls, or `undefined` when the row draws none.
 *
 * `undefined` in two cases, and they are different: the caller passed no display state at all (the
 * Now screen's cards, which deliberately show no numbers), or this document simply has no identifier.
 */
export function documentNumberProps(
  document: Document,
  numbers: NumberDisplay | undefined,
): DocumentRowProps['number'] {
  if (numbers === undefined || document.identifier === null) return undefined

  const label = numberLabelFor(document.title, document.doc_type)

  return {
    label,
    revealed: numbers.revealAll || numbers.revealedIds.has(document.id),
    grouped: groupForReading(document.identifier),
    onToggleReveal: () => numbers.onToggle(document.id),
    onCopy: () => {
      // `document.identifier` is non-null in this branch; the closure captures the narrowed value
      // rather than re-reading it, so a re-render cannot make it null underneath.
      const value = document.identifier ?? ''
      void navigator.clipboard
        .writeText(value)
        .then(() => numbers.onCopied(label))
        .catch(() => {
          // Clipboard access can be refused (insecure origin, denied permission). Revealing is the
          // fallback that always works, because the value becomes selectable — never a silent no-op.
          numbers.onToggle(document.id)
        })
    },
  }
}

/**
 * Every prop a library row needs, so the two scopes cannot disagree about any of them.
 *
 * `glyphColumn: 'wide'` is here rather than at the call sites **on purpose**. 52px is the width of a
 * thing's thumbnail, so a document's title lines up with a thing's in the merged list — and because
 * this function is the only source, a document row is indented identically whether or not a thing
 * happens to be beside it. Making it conditional on the scope is precisely the bug this file exists
 * to prevent.
 */
export function libraryDocumentRowProps(
  document: Document,
  numbers: NumberDisplay | undefined,
): DocumentRowProps {
  return {
    document,
    glyphColumn: 'wide',
    number: documentNumberProps(document, numbers),
    // Full-bleed rows with a rule below each, so the list reads as a ledger page rather than a stack
    // of cards. The negative margin undoes the shell's gutter for the rule only.
    className: '-mx-gutter border-b border-rule px-gutter',
  }
}
