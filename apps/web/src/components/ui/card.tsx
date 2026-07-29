import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A panel. ADR-0024 §3: **elevation is hairline, not shadow.**
 *
 * `--e-0` is a 1px rule and that is the whole of it — only the add sheet and the toast cast a
 * shadow, because they are the only two things temporarily on top of your life. A card with a
 * drop shadow would claim to be floating above a screen it is actually part of.
 *
 * `tone` picks the ground rather than the border, and the three status tints are how an inline alert
 * gets its colour without becoming a modal.
 */
export type CardProps = ComponentProps<'div'> & {
  tone?: 'raised' | 'sunken' | 'ok' | 'soon' | 'late'
  /** A dashed border — an empty state inviting a first action, not a filled panel. */
  dashed?: boolean
}

const TONE: Record<NonNullable<CardProps['tone']>, string> = {
  raised: 'bg-raised',
  sunken: 'bg-sunken',
  ok: 'bg-status-ok-bg',
  soon: 'bg-status-soon-bg',
  late: 'bg-status-late-bg',
}

export function Card({ className, tone = 'raised', dashed = false, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-3 text-ink',
        TONE[tone],
        dashed ? 'border border-dashed border-rule-2' : 'border border-rule-2',
        className,
      )}
      {...props}
    />
  )
}

/**
 * Padding is 16px, opening to 22px at the wider breakpoint — not 24px everywhere.
 *
 * On a 390px phone, 24px on both header and content made a two-row section about 450px tall, so the
 * screen became a scroll of mostly-empty boxes and each card read as its own page rather than as a
 * section of one screen.
 */
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col gap-1.5 p-4 pb-3 sm:p-gutter sm:pb-4', className)}
      {...props}
    />
  )
}

/** A section heading, not the screen's title — so sans 600, not the serif. */
export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-row font-semibold leading-tight', className)} {...props} />
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-body text-ink-2', className)} {...props} />
}

export function CardContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('p-4 pt-0 sm:p-gutter sm:pt-0', className)} {...props} />
}

export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex items-center gap-3 p-4 pt-0 sm:p-gutter sm:pt-0', className)}
      {...props}
    />
  )
}
