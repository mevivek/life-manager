import { Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

/**
 * Documents / Things, as segmented pills beneath the screen title. design.md §8, ADR-0029.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This is the control ADR-0025 §4 promised, drawn the day the second domain arrived.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0025 §4 decided *three tabs, forever* and said the switcher "appears the day the second domain
 * does". `TabBar` still carries the comment forbidding it — read that file before adding a fourth tab,
 * because the comp's own default is `thingsNav: "tab"` and its own §4 prose contradicts it. ADR-0029
 * chose the switcher and states the cost outright: **Things is two taps from Now rather than one.**
 *
 * Three properties, each with a failure mode:
 *
 *  1. **Pills, not a chevron menu.** ADR-0025 §4's mock drew a dropdown under `Documents ⌄`, which is
 *     right for six domains and wrong for two — a menu to choose between two things is a tap to reveal
 *     what could already be on screen. design.md §6's no-dropdowns rule applies to navigation too.
 *     **Revisit at domain four**, where a row of pills stops fitting 390px. That is the trigger, and
 *     it is the same "draw it the day it is needed" discipline that kept this file unwritten until now.
 *  2. **Real `<Link>`s, not buttons calling `navigate`.** A button gives no href, so nothing can be
 *     opened in a new tab, long-pressed, or announced as a link — and the router's own active-state
 *     machinery does not apply to it. `aria-current="page"` is what a screen reader reads as "you are
 *     here"; `selected`-style styling alone announces nothing.
 *  3. **Each domain keeps its own Add.** The pill row swaps the collection *and* what the Add button
 *     captures, because inside a domain the answer to "what are you adding" is already known
 *     (ADR-0030). That belongs to the screens, not here.
 *
 * The pills clear `--tap-min` (44px) rather than the comp's 38px. design.md §6 puts the floor on
 * everything tappable, and a *navigation* control is the worst place to shave it: a missed tap here
 * does not fail, it silently takes you to the other domain.
 */

const DOMAINS = [
  { key: 'documents', label: 'Documents', to: '/documents' },
  { key: 'things', label: 'Things', to: '/things' },
] as const

export type Domain = (typeof DOMAINS)[number]['key']

export function DomainSwitcher({ current, className }: { current: Domain; className?: string }) {
  return (
    /**
     * A `<nav>` with its own label, so the two pills are announced as a navigation landmark rather
     * than as two loose links under the heading. `aria-label` names what is being switched — "Domain"
     * — because "Documents, link" beside a heading that also says "Documents" is otherwise ambiguous.
     */
    <nav aria-label="Domain" className={cn('flex gap-1.5', className)}>
      {DOMAINS.map((domain) => {
        const isCurrent = domain.key === current
        return (
          <Link
            key={domain.key}
            to={domain.to}
            aria-current={isCurrent ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-tap shrink-0 items-center justify-center rounded-pill border px-3.5 font-sans text-body font-medium transition-colors',
              // Inversion, not a tint — the same idiom as `Chip`'s selected state, and for the same
              // reason: an ink fill survives greyscale where a background tint at this size does not.
              isCurrent
                ? 'border-ink bg-ink text-onink'
                : 'border-rule-2 bg-transparent text-ink-3 hover:bg-sunken active:bg-sunken',
            )}
          >
            {domain.label}
          </Link>
        )
      })}
    </nav>
  )
}
