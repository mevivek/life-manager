import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { AddDocumentSheet } from './AddDocumentSheet'

/**
 * Owns the Add sheet's open state and hands out the one function that opens it.
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
 */

const AddSheetContext = createContext<{ openAdd: () => void } | null>(null)

export function AddSheetProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openAdd = useCallback(() => setOpen(true), [])
  const close = useCallback(() => setOpen(false), [])
  // Memoised so every consumer of `useOpenAdd` does not re-render each time this tree does.
  const value = useMemo(() => ({ openAdd }), [openAdd])

  return (
    <AddSheetContext.Provider value={value}>
      {children}
      <AddDocumentSheet open={open} onClose={close} />
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
export function useOpenAdd(): () => void {
  const context = useContext(AddSheetContext)
  if (context === null) {
    throw new Error('useOpenAdd must be used inside <AddSheetProvider>.')
  }
  return context.openAdd
}
