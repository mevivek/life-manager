import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Alert({
  className,
  variant = 'default',
  ...props
}: ComponentProps<'div'> & { variant?: 'default' | 'destructive' }) {
  return (
    <div
      // `role="alert"` matters: it is how the error is announced to a screen reader, and how
      // the component test finds it without depending on markup.
      role="alert"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        variant === 'destructive'
          ? 'border-destructive/50 bg-destructive/10 text-destructive-foreground'
          : 'border-border bg-secondary text-secondary-foreground',
        className,
      )}
      {...props}
    />
  )
}
