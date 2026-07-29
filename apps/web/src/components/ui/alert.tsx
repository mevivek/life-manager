import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * An inline alert: tinted ground, a hairline, and — where it helps — a status glyph beside it.
 *
 * **Never a modal.** ADR-0024 §7 is explicit: nothing in this app is urgent enough to block on, and
 * a modal removes the very context that explains the message. An expired passport is not an
 * interrupt; it is a fact about a row.
 *
 * `role="alert"` is how it is announced to a screen reader, and how the component tests find it
 * without depending on markup. `variant="notice"` drops to `role="status"` instead — a condition
 * worth reporting is not an error worth stealing focus for.
 */
export type AlertProps = ComponentProps<'div'> & {
  variant?: 'destructive' | 'warning' | 'notice'
}

export function Alert({ className, variant = 'destructive', ...props }: AlertProps) {
  return (
    <div
      role={variant === 'notice' ? 'status' : 'alert'}
      className={cn(
        'rounded-3 border px-4 py-3 text-body',
        variant === 'destructive' && 'border-rule-2 bg-status-late-bg text-ink',
        variant === 'warning' && 'border-rule-2 bg-status-soon-bg text-ink',
        variant === 'notice' && 'border-rule bg-sunken text-ink-2',
        className,
      )}
      {...props}
    />
  )
}
