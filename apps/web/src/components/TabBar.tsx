import { Link, useRouterState } from '@tanstack/react-router'
import { toLedger, useLedger } from '@/features/documents/useLedger'
import { cn } from '@/lib/utils'

/**
 * The bottom tab bar — persistent app chrome.
 * [ADR-0031](../../../../docs/decisions/0031-things-is-a-fourth-tab.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Four tabs, permanently visible, always labelled: Now · Documents · Things · You.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ── This file argued for three tabs for a while, and that is now superseded ──
 *
 * Read the history, because the *reasoning* still applies to the fifth tab even though the
 * conclusion did not survive the fourth:
 *
 *  1. An even earlier version committed to growing one tab per domain — `Home · Documents ·
 *     Assets · Money`, "the bar the shape M4 needs". **ADR-0025 §4 withdrew that** and decided
 *     *three tabs, forever*: at fortnightly usage the user relearns the bar every time they open
 *     the app, so three labelled tabs is one glance. Domains were to be a *switcher* on the middle
 *     tab's title instead.
 *  2. **ADR-0029 honoured it** when Things arrived, and shipped `DomainSwitcher` — segmented pills
 *     beneath the Documents / Things title. It stated the cost outright: *Things is two taps from
 *     Now rather than one.*
 *  3. **ADR-0031 reverses that, on evidence.** The maintainer opened the shipped app and reported
 *     that Things living on the Documents screen did not match the design — which is precisely the
 *     reopening condition ADR-0029 wrote for itself. Handoff 4's own `thingsNav` knob defaults to
 *     `tab` and the comp draws the four-tab bar; the switcher was the non-default branch, chosen on
 *     the strength of ADR-0025 §4 rather than on the design's own default. `DomainSwitcher` is
 *     deleted, not left unreferenced.
 *
 * **There is no "four tabs, forever" here** — that would be the same over-commitment one slot
 * later. Four fit, measured: at 390px a slot is 84.5px and "Documents", the longest label in the
 * bar, renders 63px on one line. Five slots would be 66px and six 54px, so five is marginal and six
 * truncates. **Before adding a fifth tab, render the bar at 390px in both themes and at compact
 * density and read the longest label** (design.md §8 has the procedure, §10 the reason). When one
 * truncates or wraps, the bar is full and the switcher *pattern* returns inside a tab — ADR-0031
 * § *What happens at domain three*, which also explains why the Vault probably is not a collection
 * tab at all.
 *
 * Two rules the deleted switcher leaves behind, because they are about navigation and not pills:
 * **no dropdown, ever** (ADR-0025 §4's mocked `Documents ⌄` menu is still refused — design.md §6's
 * no-dropdowns rule covers navigation), and **navigation is `<Link>`s carrying `aria-current`**,
 * never buttons calling `navigate`.
 *
 * Now stays a single cross-domain deadline feed regardless of the tab count, because a car's MOT and
 * a passport's expiry belong in one list — that cross-domain view is the whole reason it exists.
 *
 * ── Add used to be the third tab, and is not any more ──
 *
 * The design revision replaces it with **You**, and moves Add to two places that are *about* the
 * thing being added: a text button in the Now header, and a floating pill on Documents. The argument
 * for that swap is not aesthetic. A tab bar is for **places**, and Add was never a place — it opened
 * a sheet and left you where you were, which is why it needed a callback prop while its two
 * neighbours needed a route. Meanwhile the app had nowhere to put an account, a sign-out, what it
 * holds, or a delete: those were squatting as quiet text in the Now header (see `home.tsx`) because
 * ADR-0025 §10 had no better home for them.
 *
 * A tab bar of places, with the action attached to the surfaces it acts on, is the shape that
 * survives a new domain — and it did: Things arrived as a place and needed no room made for it,
 * because Add was not occupying a slot. Add is still a sheet, not a navigation — capture happens on
 * top of what you were looking at — and `/documents/new` still exists as a real route for deep links.
 */

type Tab = {
  to: string
  label: string
  /** Matches this tab as active when the pathname starts with it. */
  match: string
  icon: (active: boolean) => React.ReactNode
}

/**
 * Inline SVG-free glyphs — plain divs, as the design draws them.
 *
 * `lucide-react` is a dependency and is used elsewhere, but none of its icons are these: the Now
 * glyph is three ruled lines of decreasing length and opacity (a ledger page), the Documents glyph is
 * a bare 2px rectangle, and Things is two bottom-aligned rectangles of different heights — two
 * objects standing on a shelf. All three are geometry rather than illustration, which is the point —
 * an icon set here would put a house, a folder and a cardboard box in an app that is none of them.
 *
 * The arbitrary pixel values below are the exception design.md §1 allows: in a glyph the value *is*
 * the content, and every one of these is read off the comp
 * (`docs/design/Life-Manager-handoff-4.dc.html` lines 900–926).
 */
/**
 * Exported only so `lib/docs.test.ts` can assert that CLAUDE.md states the number of tabs this array
 * actually has. CLAUDE.md said "four tabs" in one place and "three tabs, forever" in another for a
 * while, the second being in the routing row a layout session reads — so the count is now checked
 * against the source of truth rather than trusted to prose. Do not import this to render anything.
 */
export const TABS: Tab[] = [
  {
    to: '/home',
    label: 'Now',
    match: '/home',
    icon: () => (
      <span aria-hidden="true" className="flex flex-col gap-[2px]">
        <span className="block h-[2.5px] w-[15px] rounded-[1px] bg-current" />
        <span className="block h-[2.5px] w-[15px] rounded-[1px] bg-current opacity-55" />
        <span className="block h-[2.5px] w-[9px] rounded-[1px] bg-current opacity-30" />
      </span>
    ),
  },
  {
    to: '/documents',
    label: 'Documents',
    match: '/documents',
    icon: () => (
      <span
        aria-hidden="true"
        className="block h-4 w-[14px] rounded-[2px] border-2 border-current"
      />
    ),
  },
  {
    to: '/things',
    label: 'Things',
    /*
      `startsWith` means this lights for `/things/$thingId` too, which is the behaviour a detail
      screen needs: the bar must keep saying which collection you are inside. Same as Documents.
    */
    match: '/things',
    /*
      Two rectangles standing on a common baseline, the taller on the right — comp lines 916–919:
      a 17×15 box, `align-items: flex-end`, 2px stroke, 1px radius, 2px apart. Deliberately NOT a
      box or a tag icon: the Documents glyph is one rectangle, so two of them reads as "more than
      one object" without introducing a new visual language for it.
    */
    icon: () => (
      <span aria-hidden="true" className="flex h-[15px] w-[17px] items-end gap-[2px]">
        <span className="block h-[9px] w-[5px] rounded-[1px] border-2 border-current" />
        <span className="block h-[14px] w-[8px] rounded-[1px] border-2 border-current" />
      </span>
    ),
  },
  {
    to: '/you',
    label: 'You',
    match: '/you',
    /*
      A head and shoulders, drawn from two blocks inside a ring — the one glyph here that depicts
      something, because "you" has no geometry. Kept to the same 16px box and 2px stroke as the
      other two so it reads as a sibling rather than an icon from a different set.
    */
    icon: () => (
      <span
        aria-hidden="true"
        className="relative block size-4 overflow-hidden rounded-full border-2 border-current"
      >
        <span className="absolute top-[2px] left-[3.5px] block size-[5px] rounded-full bg-current" />
        <span className="absolute top-[8.5px] left-[0.5px] block h-2 w-[11px] rounded-t-[6px] bg-current" />
      </span>
    ),
  },
]

export function TabBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  /**
   * The badge count. Shares `useLedger`'s query key with the Now screen, so this is the same fetch
   * rather than a second one — TanStack Query dedupes on the key, which is why that hook fixes its
   * query rather than taking parameters.
   */
  const documents = useLedger()
  const ledger =
    documents.data === undefined ? null : toLedger(documents.data.data, documents.data.next_cursor)
  const attention = ledger?.needsYou.length ?? 0

  return (
    <nav
      aria-label="Main"
      /**
       * `fixed` with the safe-area inset as *padding*, not margin: the bar's background must extend
       * behind the home indicator, or there is a strip of page showing beneath it. This is why the
       * inset was removed from `body` in styles.css.
       *
       * A hairline top border and an opaque `--paper` ground rather than the previous translucent
       * blur. ADR-0025 §3: elevation is hairline, not shadow — and a blur behind a serif list makes
       * the type under it look smeared as it scrolls past.
       *
       * ── The floor is 12px, and it used to be 26px ──
       *
       * The design handoff specifies `max(env(safe-area-inset-bottom), 12px)`. This had `1.625rem`,
       * which is `--gutter` — the *horizontal* screen gutter, borrowed as a vertical floor. On a
       * home-indicator iPhone it made no difference (the inset is 34px, so `max` picks the inset
       * either way), but on a home-button iPhone, an Android with no gesture bar, or a desktop it
       * added **14px of blank paper below the labels with no home indicator on it to explain it**.
       *
       * On a device that *does* have one, the band below the labels is the safe area and is supposed
       * to be there — it is where iOS draws the swipe-up affordance. **Do not cap the inset to shrink
       * it.** The measured bar is 94px against native iOS's 83px, so there is nothing to reclaim
       * that is not the gesture area itself.
       *
       * `__root.tsx`'s bottom padding repeats this expression, and `TabBar.test.tsx` fails if the two
       * stop agreeing.
       */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper pb-[max(env(safe-area-inset-bottom),0.75rem)]"
    >
      <div className="mx-auto flex w-full max-w-2xl items-stretch gap-2 px-3.5 pt-2">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.match)
          const showBadge = tab.to === '/home' && attention > 0
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={isActive ? 'page' : undefined}
              /**
               * The badge's meaning lives on the LINK's accessible name, not on the badge.
               *
               * A bare "3" beside "Now" announces as "Now 3", which says nothing about what the three
               * are. And the badge itself is a `<span>` — `aria-label` on a element with no role is
               * ignored by most screen readers and rejected by `useAriaPropsSupportedByRole`, so
               * labelling it there would have looked correct and done nothing.
               */
              aria-label={
                showBadge
                  ? `${tab.label} — ${attention}${ledger?.complete === false ? ' or more' : ''} ${attention === 1 ? 'document needs' : 'documents need'} attention`
                  : undefined
              }
              className={cn(
                'flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-[5px] rounded-2 transition-colors',
                // `active:` gives the press feedback that removing -webkit-tap-highlight-color took
                // away. Without it, taps would feel dead.
                isActive ? 'bg-sunken text-ink' : 'bg-transparent text-ink-3 active:bg-sunken',
              )}
            >
              <span className="relative flex items-center justify-center">
                {tab.icon(isActive)}
                {showBadge && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-[3px] -right-[7px] min-w-[15px] rounded-pill bg-status-late px-[3px] text-center font-mono text-[10px] leading-[15px] text-paper"
                  >
                    {/* A capped page means the count is a floor, so say so rather than
                        under-reporting. */}
                    {attention}
                    {ledger?.complete === false ? '+' : ''}
                  </span>
                )}
              </span>
              <span className={cn('text-[12px]', isActive ? 'font-semibold' : 'font-medium')}>
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
