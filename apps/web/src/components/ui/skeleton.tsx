import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/**
 * A loading placeholder shaped like the content it replaces.
 *
 * **Why this exists rather than the string "Loading…".** The Now screen fetches several lists
 * independently, so with text placeholders it assembled itself in pieces — separate words appearing
 * and vanishing at different moments, each one changing the page height as its real content arrived.
 * A skeleton of roughly the right size means the layout is settled before the data lands.
 *
 * **First paint only.** ADR-0025 §7: a *refresh* keeps the stale list and dims nothing. Replacing
 * real content with shimmer on every refetch is how an app that is working looks broken.
 *
 * The shimmer is a moving gradient rather than an opacity pulse, and the keyframe lives in
 * `styles.css` because a keyframe belongs beside the tokens in Tailwind v4's CSS-first theme. The
 * geometry matches the design's spec: a 12px label bar and 58px rows.
 */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      // `aria-hidden` and no text: a screen reader should hear the eventual content, not a
      // description of a loading rectangle. The live region belongs on the container.
      aria-hidden="true"
      className={cn(
        'rounded-2 bg-[linear-gradient(90deg,var(--sunken),var(--rule),var(--sunken))] bg-[length:320px_100%]',
        '[animation:ledger-shimmer_1.3s_linear_infinite]',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The Now screen's first paint: an eyebrow-sized bar, then rows.
 *
 * 58px rather than the 72px a real row occupies. That is deliberate and not a mismatch — the
 * shimmer stands in for the row's *content box*, and matching the full row height including its
 * padding made the placeholder read as taller than the list that replaced it.
 */
export function DocumentListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div
      className="flex flex-col gap-3.5"
      role="status"
      aria-label="Loading documents"
      aria-live="polite"
    >
      <Skeleton className="h-3 w-2/5 rounded-1" />
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder, never reordered
        <Skeleton key={index} className="h-[58px]" />
      ))}
    </div>
  )
}
