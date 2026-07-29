import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * A bottom sheet — one of the two things in the app that lifts (ADR-0024 §3).
 *
 * ── Hand-rolled rather than a dependency ──
 *
 * This is ~90 lines and the alternative (`@radix-ui/react-dialog`) is a new runtime dependency plus
 * its focus-management peer, for one component in one place. The four things a dialog has to get
 * right are all below and all testable: Escape closes, focus is trapped, focus returns where it came
 * from, and the page behind does not scroll.
 *
 * ── Native `<dialog>` was tried and rejected ──
 *
 * `showModal()` gives Escape, focus trapping and the top layer for free, but its `::backdrop` cannot
 * be animated in step with the sheet in Safari, and a `<dialog>` sized to the bottom of the viewport
 * fights `env(safe-area-inset-bottom)` because the top layer is not in the normal flow. The
 * behaviours are cheaper to write than those two bugs are to work around.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  children,
}: {
  open: boolean
  onClose: () => void
  /** The `id` of the sheet's heading — its accessible name. */
  labelledBy?: string
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  /** Where focus was before the sheet opened, so it can be handed back on close. */
  const restoreTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    /**
     * Focus the first field, or the panel itself.
     *
     * This is what makes the design's 5-second capture budget achievable: *"the field is focused
     * before the user decides anything, and the keyboard is already up."* Focusing on the way up
     * rather than after the animation is the difference between one tap and two.
     */
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    const first = focusable?.[0]
    if (first !== undefined) first.focus()
    else panelRef.current?.focus()

    /**
     * Lock the page behind. Without this, scrolling inside the sheet chains to the document once it
     * hits its end — the sheet stays put and the screen underneath slides, which looks like a bug.
     * `overscroll-behavior` on the panel handles the same thing for touch.
     */
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      // Cycle focus inside the panel. Queried on every Tab rather than cached, because the sheet's
      // content changes — the optional fields unfold, and the saved step replaces the form entirely.
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (nodes === undefined || nodes.length === 0) return
      const list = Array.from(nodes)
      const firstNode = list[0]
      const lastNode = list[list.length - 1]
      if (firstNode === undefined || lastNode === undefined) return

      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault()
        lastNode.focus()
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault()
        firstNode.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    /**
     * The backdrop closes the sheet. `onMouseDown` rather than `onClick`: with `onClick`, a drag that
     * *starts* inside the sheet and *ends* on the backdrop counts as a backdrop click and discards
     * what the user was typing.
     *
     * `noStaticElementInteractions` is suppressed rather than satisfied, because satisfying it would
     * mean giving the backdrop a `button` role — which would put a second, unlabelled "close" control
     * in the tab order *inside* the focus trap, immediately before the real one. The backdrop is
     * decoration for pointer users; the keyboard paths to close are Escape (tested) and the sheet's
     * own Cancel button, and both are real controls.
     */
    // biome-ignore lint/a11y/noStaticElementInteractions: a dialog backdrop is pointer-only decoration; Escape and Cancel are the accessible close paths
    <div
      className="fixed inset-0 z-50 flex items-end bg-[rgb(10_10_9_/_0.42)] [animation:ledger-fade_var(--m-fast)_ease-out]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* `tabIndex={-1}` makes the panel programmatically focusable — it is the fallback focus target
          when the sheet holds no field at all. It stays out of the tab order. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn(
          'max-h-[92%] w-full overflow-y-auto overscroll-contain bg-paper shadow-sheet',
          // 22px top corners only: the sheet is anchored to the bottom edge, so rounding the bottom
          // would float it and reveal the backdrop beneath the home indicator.
          'rounded-t-4',
          'px-gutter pt-2 pb-[max(env(safe-area-inset-bottom),1.875rem)]',
          '[animation:ledger-rise_var(--m-base)_var(--m-ease)]',
        )}
      >
        {/* The grab handle. Decoration — this sheet is not draggable, and the handle is there
            because its absence makes a bottom sheet read as a stuck panel. `aria-hidden` so it is
            not announced as content. */}
        <div aria-hidden="true" className="flex justify-center pt-1.5 pb-3.5">
          <div className="h-1 w-10 rounded-[2px] bg-rule-2" />
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * What counts as focusable for the trap.
 *
 * `:not([disabled])` matters on this form specifically: Save is disabled at zero characters, and
 * without the exclusion Tab would land on a control that cannot be activated.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
