import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * **Why this exists rather than the string "Loading…".** The dashboard fetches five lists
 * independently, so with text placeholders it assembled itself in pieces — five separate words
 * appearing and vanishing at different moments, each one changing the page height as its real
 * content arrived. A skeleton of roughly the right size means the layout is settled before the data
 * lands, so nothing jumps.
 *
 * The keyframe is in `styles.css` rather than an arbitrary-value class, because Tailwind v4's
 * `animate-pulse` is tied to its own timing and this needs to be slower and shallower — a fast,
 * high-contrast pulse reads as an error state.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      // `aria-hidden` and no text: a screen reader should hear the eventual content, not a
      // description of a loading rectangle. The live region belongs on the container.
      aria-hidden="true"
      className={cn(
        'rounded-md bg-muted',
        '[animation:skeleton-pulse_1.6s_ease-in-out_infinite]',
        className,
      )}
      {...props}
    />
  )
}

/** A placeholder shaped like one `DocumentRow` — the shape used in every list. */
export function DocumentRowSkeleton() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-3">
      <div className="flex min-w-0 flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  )
}

/**
 * `count` rows of list skeleton. Defaults to 3 — enough to read as "a list is coming" without
 * implying a specific length the real data then contradicts.
 */
export function DocumentListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading documents">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
        <DocumentRowSkeleton key={index} />
      ))}
    </div>
  )
}
