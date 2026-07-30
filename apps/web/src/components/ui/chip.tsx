import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A pill. Filter chips, type pickers, reminder lead times.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This is the system's `<select>`, and that is a decision rather than an omission.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0025 §7: **no dropdowns anywhere.** Seven document types is a wrapping row of pills, because a
 * native `<select>` on a 390px screen opens an OS sheet that is *worse* than the seven options
 * already being visible — it costs a tap, hides the choices behind a label, and on iOS renders a
 * wheel the user has to scroll past "Certificate" to reach "Other".
 *
 * The old `DocumentList` and `DocumentForm` both used a `<select>` for exactly this. Replacing them
 * is the single biggest interaction change in the redesign.
 *
 * ── `selected` inverts, it does not tint ──
 *
 * A selected chip is ink-filled with `--onink` text; an unselected one is a transparent hairline.
 * Inversion survives greyscale, which a background tint at this size does not.
 */
export type ChipProps = ComponentProps<'button'> & {
  selected?: boolean
  /** 40px inside a form (thumb-sized), 36px in a scrolling filter row. */
  size?: 'default' | 'sm'
}

export function Chip({
  className,
  selected = false,
  size = 'default',
  type = 'button',
  ...props
}: ChipProps) {
  return (
    <button
      type={type}
      // `aria-pressed` rather than a bare button: a filter chip is a toggle, and without it a
      // screen reader announces "Identity, button" with no hint that it is currently on.
      aria-pressed={selected}
      className={cn(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-pill border px-3 font-sans font-medium transition-colors',
        size === 'default' ? 'min-h-10 text-row' : 'min-h-9 text-body',
        selected
          ? 'border-ink bg-ink text-onink'
          : 'border-rule-2 bg-transparent text-ink-2 hover:bg-sunken active:bg-sunken',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The same pill shape with no behaviour — a reminder lead time, a tag.
 *
 * A `<span>`, not a disabled `<button>`: a disabled button is still announced as a control the user
 * cannot use, which is a worse description of "90 days before" than no control at all.
 */
export function Tag({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'inline-flex min-h-[1.875rem] items-center rounded-pill border border-rule-2 px-2.5 font-sans text-meta text-ink-2',
        className,
      )}
      {...props}
    />
  )
}
