import { useEffect } from 'react'
import { cn } from '@/lib/utils'

/**
 * The ink toast — the second of the two things that lift (ADR-0024 §3).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The design comp drew an "Undo" button here. It is deliberately not implemented.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `DELETE /documents/:id` is a **soft** delete — it sets `deleted_at`, and every repository query
 * filters `deleted_at IS NULL`. So the row does survive, but there is no restore endpoint and no
 * purge policy, which means:
 *
 *  - An "Undo" button would have nothing to call.
 *  - The comp's companion line, *"Recoverable for 30 days"*, would be a promise the system does not
 *    keep — recoverable by someone with database access is not recoverable by the user, and 30 days
 *    is a number no job enforces.
 *
 * Shipping either would be a UI that lies, so `action` exists as a prop for when a real undo does,
 * and the delete flow does not pass one. See ADR-0024 §10 for the open item.
 */
export function Toast({
  message,
  onDismiss,
  action,
  durationMs = 5000,
}: {
  message: string
  onDismiss: () => void
  /** Only pass this when the action can genuinely be performed. */
  action?: { label: string; onAction: () => void }
  durationMs?: number
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs)
    return () => clearTimeout(timer)
  }, [onDismiss, durationMs])

  return (
    <div
      /**
       * `role="status"` with `aria-live="polite"`, not `role="alert"`.
       *
       * A toast confirms something the user just did on purpose. An assertive live region interrupts
       * whatever a screen reader was mid-sentence on to announce a thing the user already knows they
       * did.
       */
      role="status"
      aria-live="polite"
      className={cn(
        // Sits above the tab bar rather than over it: covering the nav to announce a success is how
        // a confirmation becomes an obstacle.
        'fixed inset-x-3.5 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-40',
        'flex items-center gap-3 rounded-3 bg-ink px-4 py-3.5 text-onink shadow-toast',
        '[animation:ledger-rise_var(--m-base)_var(--m-ease)]',
      )}
    >
      <span className="flex-1 font-sans text-body font-medium">{message}</span>
      {action !== undefined && (
        <button
          type="button"
          onClick={() => {
            action.onAction()
            onDismiss()
          }}
          className="min-h-tap px-1 font-sans text-body font-semibold text-onink"
        >
          {action.label}
        </button>
      )}
    </div>
  )
}
