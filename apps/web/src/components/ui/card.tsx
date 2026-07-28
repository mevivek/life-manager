import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card text-card-foreground', className)}
      {...props}
    />
  )
}

/**
 * Padding is `p-4` with `sm:p-6`, not `p-6` everywhere.
 *
 * On a 390px phone — the primary target — `p-6` on both header and content made a two-row section
 * about 450px tall, so the dashboard became a long scroll of mostly-empty boxes and each card read
 * as its own page rather than as a section of one screen.
 */
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex flex-col gap-1.5 p-4 pb-3 sm:p-6 sm:pb-4', className)} {...props} />
  )
}

/** `text-base` on mobile: a card title is a section heading, not the screen's title. */
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return (
    <h2 className={cn('text-base font-semibold leading-none sm:text-lg', className)} {...props} />
  )
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('flex items-center gap-3 p-4 pt-0 sm:p-6 sm:pt-0', className)} {...props} />
  )
}
