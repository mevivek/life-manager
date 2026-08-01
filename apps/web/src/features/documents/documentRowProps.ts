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

/**
 * What a list has to supply for its rows to draw numbers at all (ADR-0027, amended by ADR-0036).
 *
 * It used to carry the revealed set, `revealAll` and a toggle, because the archive header had a
 * page-wide Show. ADR-0036 replaced that with a device preference on the You screen, so reveal is
 * per-row state inside `DocumentRow` and nothing about it needs hoisting. What is left is the one
 * thing a row genuinely cannot do for itself: tell the *page* to say something.
 */
export type NumberDisplay = {
  /** Called with the number's label after a successful copy, so the page can say so. */
  onCopied: (label: string) => void
  /**
   * Called when the clipboard refuses — an insecure origin, a denied permission. Separate from
   * `onCopied` so the page can say which happened; the failure used to be answered by revealing the
   * row, which is neither available nor useful now that the value is on screen by default.
   */
  onCopyFailed: (label: string) => void
}

/**
 * The number line and its Copy control, or `undefined` when the row draws none.
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
    grouped: groupForReading(document.identifier),
    onCopy: () => {
      // `document.identifier` is non-null in this branch; the closure captures the narrowed value
      // rather than re-reading it, so a re-render cannot make it null underneath.
      const value = document.identifier ?? ''
      void navigator.clipboard
        .writeText(value)
        .then(() => numbers.onCopied(label))
        .catch(() => {
          // Clipboard access can be refused (insecure origin, denied permission). Say so — the old
          // fallback revealed the row, which is meaningless now that the number is on screen unless
          // the user has asked otherwise. Never a silent no-op.
          numbers.onCopyFailed(label)
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
  /** Forwarded so a person's own page can suppress the pill naming that person. */
  options: { showHolder?: boolean } = {},
): DocumentRowProps {
  return {
    document,
    glyphColumn: 'wide',
    showHolder: options.showHolder ?? true,
    number: documentNumberProps(document, numbers),
    // Full-bleed rows with a rule below each, so the list reads as a ledger page rather than a stack
    // of cards. The negative margin undoes the shell's gutter for the rule only.
    className: '-mx-gutter border-b border-rule px-gutter',
  }
}
