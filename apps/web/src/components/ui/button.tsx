import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * Buttons. ADR-0024 §7.
 *
 * Four kinds, and the boundaries between them are meaning rather than decoration:
 *
 *  - **primary** — ink fill, `--onink` text. The one thing to do on this screen.
 *  - **secondary** — 1px `--rule-2` on `--raised`. A real alternative to the primary.
 *  - **quiet** — text only, no border, still 44px tall. Reveals, cancels, toggles.
 *  - **destructive** — text only in `--status-late`. **Never a red block**: colour in this system is
 *    spent on status, and a filled red button would make "delete" the loudest thing on a screen
 *    whose actual subject is a passport.
 *
 * `dashed` is a fifth, and it is a genuine variant rather than a styling flourish: an *invitation*
 * to add something optional ("attach a scan", "add another version"). A solid button there would
 * read as a step the user is expected to complete.
 *
 * ── Every size clears 44px ──
 *
 * `--tap-min` is 44px and no variant goes below it, including `quiet`. A text button with no
 * background still needs a thumb-sized hit area; giving it one is invisible, and skipping it is the
 * single most common phone bug. `sm` is 44px too — it is *narrower*, not shorter.
 *
 * There is no `focus-visible` handling here: `styles.css` puts a 2px `--focus` ring at 2px offset on
 * `:focus-visible` globally, because the one element whose focus ring gets forgotten is always the
 * one nobody remembered to style.
 */
const buttonVariants = cva(
  cn(
    'inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans transition-colors',
    'disabled:pointer-events-none disabled:opacity-50',
  ),
  {
    variants: {
      variant: {
        primary: 'rounded-2 bg-ink font-semibold text-onink hover:opacity-90 active:opacity-90',
        secondary:
          'rounded-2 border border-rule-2 bg-raised font-medium text-ink hover:bg-sunken active:bg-sunken',
        quiet: 'rounded-2 bg-transparent font-medium text-ink-2 hover:bg-sunken active:bg-sunken',
        destructive:
          'rounded-2 bg-transparent font-medium text-status-late hover:bg-status-late-bg active:bg-status-late-bg',
        dashed:
          'rounded-3 border border-dashed border-rule-2 bg-transparent font-medium text-ink-2 hover:bg-sunken active:bg-sunken',
      },
      size: {
        /** The field height, so a button stacked under an input lines up with it. */
        default: 'min-h-field px-4 text-row',
        /** Full-bleed primary in a sheet: a step larger, so it reads as the destination. */
        lg: 'min-h-[3.375rem] px-4 text-[1.0625rem]',
        /** Still 44px tall — narrower, not shorter. */
        sm: 'min-h-tap px-3 text-body',
        /** Text-only: no horizontal padding, but still a 44px row to hit. */
        bare: 'min-h-tap px-0 text-body',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>

/**
 * `type="button"` by default.
 *
 * The HTML default is `submit`, so every disclosure toggle and cancel control inside a form submits
 * it unless told otherwise — a bug that only appears once a button is placed in a form, and which
 * then looks like the form is broken rather than the button. Callers wanting a submit say so.
 */
export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}

export { buttonVariants }
