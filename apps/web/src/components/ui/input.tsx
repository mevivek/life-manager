import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A text field. ADR-0024 §7.
 *
 * 52px tall (`--field-h`), 10px radius, 1px `--rule-2`, and **16px text as a hard floor** — below
 * 16px iOS Safari zooms the whole page when the field takes focus, which on a fixed layout looks
 * like the app broke.
 *
 * ── `emphasis` draws "required" by WEIGHT, not by an asterisk ──
 *
 * The one required field on a form gets a 1.5px `--ink` border instead of the 1px `--rule-2` one.
 * That reads as "this is the field that matters" without adding a glyph the user has to decode, and
 * it scales honestly: on a form where *everything else is optional forever* (Q2), an asterisk on one
 * field implies the others were merely not-yet-starred.
 *
 * It is `emphasis` rather than `required` on purpose — this is a visual weight, and the actual
 * validation lives in `documentCreateSchema`. A component prop that claimed to mean "required" while
 * enforcing nothing would be a lie in the type system.
 */
export type InputProps = ComponentProps<'input'> & { emphasis?: boolean }

export function Input({ className, type, emphasis = false, ...props }: InputProps) {
  return (
    <input
      type={type}
      className={cn(
        'flex h-field w-full rounded-2 bg-raised px-[0.875rem] text-ink',
        'text-[max(1rem,16px)] placeholder:text-ink-3',
        'disabled:cursor-not-allowed disabled:opacity-50',
        emphasis ? 'border-[1.5px] border-ink' : 'border border-rule-2',
        // aria-invalid is what the forms already set; keeping the hook means an invalid field is
        // marked for sighted users too, not only announced.
        'aria-invalid:border-[1.5px] aria-invalid:border-status-late',
        className,
      )}
      {...props}
    />
  )
}
