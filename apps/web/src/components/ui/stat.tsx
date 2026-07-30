import type { ReactNode } from 'react'

/**
 * One `term / value` line, as a description list row rather than a `<div>` pair.
 *
 * `<dl>` is the semantic that makes "Documents / 2" announce as a pair. A row of two spans reads as
 * two unrelated strings, which for a screen that is *entirely* label-and-value is the whole content.
 * Always render these inside a `<dl>`.
 *
 * Lives here rather than in `routes/_authed/you.tsx`, where it started, because the Build card
 * (`features/health/BuildCard.tsx`) is a second set of these rows on the same screen and importing
 * it from the route module would have made the route and the feature import each other.
 */
export function Stat({
  term,
  value,
  note,
  action,
  /**
   * Mono, and only for a value the **machine** names.
   *
   * design.md §3 gives mono one job — eyebrow labels, masks, serials, counts, commit shas. Applying
   * it to every value put "Single user" and "Gone from every list" in a typewriter face, which reads
   * as code rather than as an answer. Counts get mono because a column of digits should align;
   * sentences get the sans they are written in.
   */
  mono = false,
}: {
  term: string
  /**
   * A `ReactNode` rather than a `string` so a value can carry its own affordances — the commit rows
   * need `title` and `.selectable` on the sha itself, and threading three more props through here to
   * reach one `<span>` would be worse than letting the caller pass the span.
   */
  value: ReactNode
  note?: string
  action?: ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-h-12 items-baseline justify-between gap-3.5 border-b border-rule py-3">
      <dt className="text-body text-ink-2">
        {term}
        {note !== undefined && <span className="mt-px block text-meta text-ink-3">{note}</span>}
      </dt>
      {/* One `<dd>` per `<dt>`, so the value and its control stay inside the same pair rather than
          the control becoming an orphan definition with no term. */}
      <dd className="flex shrink-0 items-baseline gap-2.5 text-right">
        <span className={mono ? 'font-mono text-row' : 'text-body'}>{value}</span>
        {action !== undefined && <span className="-mr-3">{action}</span>}
      </dd>
    </div>
  )
}
