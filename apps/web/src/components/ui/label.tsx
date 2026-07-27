import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * `a11y/noLabelWithoutControl` is disabled for `components/ui/**` in biome.json, and this is the
 * file that needs it: a generic primitive cannot know its control, because `htmlFor` is supplied
 * by the caller. The rule still applies everywhere it can actually see the pairing — the two auth
 * forms both pass `htmlFor`, and `SignInForm.test.tsx` finds its fields by `getByLabelText`,
 * which fails outright if the association breaks.
 */
export function Label({ className, ...props }: ComponentProps<'label'>) {
  return (
    <label
      className={cn('text-sm font-medium leading-none text-foreground', className)}
      {...props}
    />
  )
}
