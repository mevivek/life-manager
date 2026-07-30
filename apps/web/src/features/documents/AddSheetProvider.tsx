import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { type CaptureIntent, CaptureSheet } from './CaptureSheet'

/**
 * Owns the capture sheet's open state and hands out the functions that open it.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why this is a context now, when a `useState` and one prop was right before
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `__root.tsx` used to hold `addOpen` and pass an `onAdd` callback to `TabBar`, with a comment saying
 * a provider for a single boolean is indirection that has to be read before the boolean can be found.
 * That was true while the tab bar was the only thing that could open it.
 *
 * The design revision moves Add **off** the tab bar — the third tab is now You — and puts it in two
 * places instead: a text button in the Now header and a floating pill on Documents. Both live inside
 * `<Outlet />`, so a prop from the root would have to be threaded through the router to reach them.
 * Three consumers in two routes is the condition that comment set for changing its mind.
 *
 * The sheet is still rendered **here**, above the shell, for the original reason: mounted inside the
 * fixed tab bar it would be clipped by it and stack below the content it is meant to cover.
 *
 * ── One sheet, three doors, and the shape of the API is deliberate ──
 *
 * [ADR-0030](../../../../docs/decisions/0030-capture-as-a-stepped-wizard.md) gives capture two tracks
 * and one entry point, plus the *"filing against a thing"* variant from things.md §7. All three are
 * the same component with a different `CaptureIntent`, so this exposes three zero-or-one-argument
 * functions rather than one function taking a track.
 *
 * **`openAdd` stays argument-free on purpose.** Both existing call sites pass it straight to
 * `onClick`, so widening it to `openAdd(options?)` would hand it a `MouseEvent` as its intent — which
 * type-checks, does nothing visible, and would be a genuinely nasty thing to find later.
 */

type AddSheetValue = {
  /** The common case: a document, from step one. */
  openAdd: () => void
  /** The Things list's own Add — the track is known, so the sheet skips asking. */
  openAddThing: () => void
  /** A document filed against a thing, from a papers checklist. Drops the `type` step. */
  openAddAgainst: (intent: {
    thing: { id: string; name: string }
    preset?: string
    title?: string
  }) => void
}

const AddSheetContext = createContext<AddSheetValue | null>(null)

export function AddSheetProvider({ children }: { children: ReactNode }) {
  /**
   * `null` is closed. Holding the *intent* rather than a boolean plus three more pieces of state is
   * what keeps "which track, against which thing" from being able to disagree with "is it open".
   */
  const [intent, setIntent] = useState<CaptureIntent | null>(null)

  const openAdd = useCallback(() => setIntent({ track: 'document' }), [])
  const openAddThing = useCallback(() => setIntent({ track: 'thing' }), [])
  const openAddAgainst = useCallback<AddSheetValue['openAddAgainst']>(
    ({ thing, preset, title }) => setIntent({ track: 'document', forThing: thing, preset, title }),
    [],
  )
  const close = useCallback(() => setIntent(null), [])

  // Memoised so every consumer does not re-render each time this tree does.
  const value = useMemo<AddSheetValue>(
    () => ({ openAdd, openAddThing, openAddAgainst }),
    [openAdd, openAddThing, openAddAgainst],
  )

  return (
    <AddSheetContext.Provider value={value}>
      {children}
      <CaptureSheet open={intent !== null} onClose={close} intent={intent ?? undefined} />
    </AddSheetContext.Provider>
  )
}

/**
 * Throws rather than returning a no-op when there is no provider.
 *
 * A silent no-op would give a button that renders, focuses, announces and does **nothing** when
 * tapped — the failure mode this codebase has already shipped twice in visual form. Failing at mount
 * makes it a crash in development instead of a dead control in production.
 */
export function useAddSheet(): AddSheetValue {
  const context = useContext(AddSheetContext)
  if (context === null) {
    throw new Error('useAddSheet must be used inside <AddSheetProvider>.')
  }
  return context
}

/**
 * The document-track opener on its own, which is what every existing Add control wants.
 *
 * Kept as its own hook rather than folded into `useAddSheet` because the call sites pass it directly
 * to `onClick` — see the note on `openAdd` above.
 */
export function useOpenAdd(): () => void {
  return useAddSheet().openAdd
}
