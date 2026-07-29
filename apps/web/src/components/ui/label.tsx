import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A field label, in the system's eyebrow type: 11px mono, uppercase, `.09em` tracked, `--ink-3`.
 *
 * Mono for labels and sans for content is the split the whole design rests on — *the machine's
 * words in mono, the human's in serif, the interface's in sans* (ADR-0025 §3). A label is the
 * machine naming a slot, so it is mono, and at 11px uppercase it reads as a caption rather than
 * competing with the value beneath it.
 *
 * `a11y/noLabelWithoutControl` is disabled for `components/ui/**` in biome.json, and this is the
 * file that needs it: a generic primitive cannot know its control, because `htmlFor` is supplied
 * by the caller. The rule still applies everywhere it can actually see the pairing — the two auth
 * forms both pass `htmlFor`, and `SignInForm.test.tsx` finds its fields by `getByLabelText`,
 * which fails outright if the association breaks.
 */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn(
        'font-mono text-label font-medium uppercase leading-none tracking-label text-ink-3',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The same type, without a `for` — a section eyebrow ("Needs you", "The horizon", "Scans").
 *
 * A separate component rather than a `Label` without `htmlFor`, because a `<label>` that labels
 * nothing is a real accessibility defect: screen readers announce it as a form label and then find
 * no control. This renders a `<span>` and is honest about being decoration.
 */
export function Eyebrow({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'font-mono text-label font-medium uppercase leading-none tracking-label text-ink-3',
        className,
      )}
      {...props}
    />
  )
}
