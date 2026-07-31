import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { AddPicker } from './AddPicker'
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
 * ── One sheet, four doors, and the shape of the API is deliberate ──
 *
 * [ADR-0030](../../../../docs/decisions/0030-capture-as-a-stepped-wizard.md) gives capture two tracks
 * and one entry point, plus the *"filing against a thing"* variant from things.md §7. All of those are
 * the same component with a different `CaptureIntent`, so this exposes zero-or-one-argument functions
 * rather than one function taking a track.
 *
 * **`openPicker` is the fourth, and it is the default door now.**
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md) merged the two collection screens
 * into one, so the Add pill on it can no longer infer a track from where it was tapped. It opens
 * `AddPicker`, which asks once and then calls `openAdd` or `openAddThing` — see that component for
 * why the question is a fork rather than a seventh wizard step.
 *
 * **`openAdd` stays argument-free on purpose.** Its call sites pass it straight to `onClick`, so
 * widening it to `openAdd(options?)` would hand it a `MouseEvent` as its intent — which type-checks,
 * does nothing visible, and would be a genuinely nasty thing to find later.
 */

type AddSheetValue = {
  /**
   * The default door: ask which track, then start it. Every Add control that is **not** already
   * inside one domain uses this — the Now header, and the library's pill.
   */
  openPicker: () => void
  /** The document track, from step one. Used once the track is known. */
  openAdd: () => void
  /** A thing's own screen — the track is known, so the sheet skips asking. */
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
  /**
   * The picker's own open state, deliberately **separate** from `intent` rather than a third
   * `CaptureIntent` variant.
   *
   * They are two different sheets with two different lifetimes: picking a track closes this one and
   * opens that one, and a `track: 'unknown'` intent would have made `CaptureSheet` responsible for
   * rendering a screen that is not one of its six steps. Keeping them apart is also what makes
   * "picker open, wizard closed" unrepresentable as anything other than what it is.
   */
  const [picking, setPicking] = useState(false)

  const openPicker = useCallback(() => setPicking(true), [])
  const openAdd = useCallback(() => {
    setPicking(false)
    setIntent({ track: 'document' })
  }, [])
  const openAddThing = useCallback(() => {
    setPicking(false)
    setIntent({ track: 'thing' })
  }, [])
  const openAddAgainst = useCallback<AddSheetValue['openAddAgainst']>(
    ({ thing, preset, title }) => setIntent({ track: 'document', forThing: thing, preset, title }),
    [],
  )
  const close = useCallback(() => setIntent(null), [])
  const closePicker = useCallback(() => setPicking(false), [])

  // Memoised so every consumer does not re-render each time this tree does.
  const value = useMemo<AddSheetValue>(
    () => ({ openPicker, openAdd, openAddThing, openAddAgainst }),
    [openPicker, openAdd, openAddThing, openAddAgainst],
  )

  return (
    <AddSheetContext.Provider value={value}>
      {children}
      {/*
        Both sheets are rendered here, above the shell, for the reason in this file's header: mounted
        inside the fixed tab bar they would be clipped by it. Only one is ever open — picking a track
        closes the picker in the same state update that opens the wizard, so there is no frame with
        two dialogs stacked.
      */}
      <AddPicker
        open={picking}
        onClose={closePicker}
        onPickDocument={openAdd}
        onPickThing={openAddThing}
      />
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
 * The opener a general-purpose Add control wants — the picker, since ADR-0032.
 *
 * **It used to return `openAdd`, the document track**, which was right while Documents and Things
 * each had their own screen and their own pill. They do not: the Now header and the library's pill
 * both sit above a list holding *both* kinds, so starting the document wizard from either is a guess
 * that is wrong about half the time.
 *
 * Kept as its own hook rather than folded into `useAddSheet` because the call sites pass it directly
 * to `onClick` — see the note on `openAdd` above.
 */
export function useOpenAdd(): () => void {
  return useAddSheet().openPicker
}
