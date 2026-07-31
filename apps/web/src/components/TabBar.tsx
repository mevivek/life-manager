import { Link, useRouterState } from '@tanstack/react-router'
import { toLedger, useLedger } from '@/features/documents/useLedger'
import { cn } from '@/lib/utils'

/**
 * The bottom tab bar — persistent app chrome.
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Three tabs, permanently visible, always labelled: Now · Everything · You.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The bar has been three, then four, and is three again ──
 *
 * Read the history, because each reversal was made on different evidence and the *reasoning* is what
 * carries forward — the conclusions have not:
 *
 *  1. An even earlier version committed to growing one tab per domain — `Home · Documents ·
 *     Assets · Money`, "the bar the shape M4 needs". **ADR-0025 §4 withdrew that** and decided
 *     *three tabs, forever*: at fortnightly usage the user relearns the bar every time they open
 *     the app, so three labelled tabs is one glance. Domains were to be a *switcher* on the middle
 *     tab's title instead.
 *  2. **ADR-0029 honoured it** when Things arrived, and shipped `DomainSwitcher` — segmented pills
 *     beneath the Documents / Things title. It stated the cost outright: *Things is two taps from
 *     Now rather than one.*
 *  3. **ADR-0031 reversed that, on evidence**: the maintainer opened the shipped app, could not
 *     find Things, and handoff 4's own `thingsNav` knob defaulted to `tab`. Four tabs shipped and
 *     `DomainSwitcher` was deleted.
 *  4. **ADR-0032 goes back to three, and it is not a re-litigation of 3.** Handoff 5 does not
 *     restore the switcher between two screens — it **merges the two collections into one**. The
 *     middle tab is a place called *Everything* holding documents and things in one dated list, with
 *     `All / Documents / Things` narrowing it. What ADR-0031 fixed stays fixed: Things is one tap
 *     from anywhere, and it is not hidden behind Documents. What it cost — a fourth slot, and two
 *     screens that could never show you both — is what this buys back.
 *
 * **There is no "three tabs, forever" here.** That claim has now been made and broken once, and
 * ADR-0031 declined to make its own version of it for the same reason. Three fit with room to spare;
 * the measurement, and the point at which the bar is full, is design.md §8 — **run it before adding a
 * fourth**, because the answer has changed twice and will not be guessed correctly.
 *
 * Two rules survive every one of those reversals, because they are about navigation itself:
 * **no dropdown, ever** (ADR-0025 §4's mocked `Documents ⌄` menu is still refused — design.md §6's
 * no-dropdowns rule covers navigation), and **navigation is `<Link>`s carrying `aria-current`**,
 * never buttons calling `navigate`. The library's scope pills are not an exception to the second:
 * they navigate nowhere, they filter one list. See `features/library/scope.ts`.
 *
 * Now stays a single cross-domain deadline feed regardless of the tab count, because a car's MOT and
 * a passport's expiry belong in one list — that cross-domain view is the whole reason it exists, and
 * it is now the *second* place in the app organised that way rather than the only one.
 *
 * ── Add used to be the third tab, and is not any more ──
 *
 * The design revision replaces it with **You**, and moves Add to two places that are *about* the
 * thing being added: a text button in the Now header, and a floating pill on the library. The argument
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
  /**
   * Pathname prefixes that light this tab.
   *
   * A **list**, because the library's tab is one place with three URLs under it: `/library` itself
   * and the two detail routes, `/documents/$documentId` and `/things/$thingId`, which are still
   * addressed by domain (a document's URL naming the library it happens to be filed in would be an
   * odd thing to paste to somebody). A bar that goes blank one level down tells the user they have
   * left the app's structure, so both detail routes keep their collection's tab lit.
   */
  match: readonly string[]
  icon: (active: boolean) => React.ReactNode
}

/**
 * Inline SVG-free glyphs — plain divs, as the design draws them.
 *
 * `lucide-react` is a dependency and is used elsewhere, but none of its icons are these: the Now
 * glyph is three ruled lines of decreasing length and opacity (a ledger page), Everything is a 2×2
 * grid of mixed tiles, and You is a head and shoulders. All three are geometry rather than
 * illustration, which is the point — an icon set here would put a house, a folder and a cardboard box
 * in an app that is none of them.
 *
 * The arbitrary pixel values below are the exception design.md §1 allows: in a glyph the value *is*
 * the content, and every one of these is read off the comp
 * (`docs/design/Life-Manager-handoff-5.dc.html`).
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
    match: ['/home'],
    icon: () => (
      <span aria-hidden="true" className="flex flex-col gap-[2px]">
        <span className="block h-[2.5px] w-[15px] rounded-[1px] bg-current" />
        <span className="block h-[2.5px] w-[15px] rounded-[1px] bg-current opacity-55" />
        <span className="block h-[2.5px] w-[9px] rounded-[1px] bg-current opacity-30" />
      </span>
    ),
  },
  {
    to: '/library',
    label: 'Everything',
    /*
      Three prefixes for one tab. `/library` is the screen; the two detail routes keep their own
      addresses and still light it, so walking into a document and back out never blanks the bar.
    */
    match: ['/library', '/documents', '/things'],
    /*
      ── A 2×2 grid of tiles, and it replaces two glyphs rather than joining them ──

      The old bar drew a rectangle for Documents and two standing rectangles for Things. Neither
      survives, because neither is honest about a tab holding both: the rectangle would say "papers"
      about a list containing a car, and the two-objects glyph would say "possessions" about a list
      containing a passport.

      So: four tiles, mixed shapes, descending opacity — a *collection* of unlike items rather than a
      picture of any one of them. The circle in the second slot is what stops it reading as a generic
      grid or an app-drawer icon; it is the one deliberately-not-square tile, and it carries the
      "these are different kinds of thing" idea on its own.

      Comp lines 1008–1016: 7px tiles, 3px gap, `border-radius: 1.5px` on the squares and 50% on the
      circle, opacity 1 / .8 / .45 / .25. The arbitrary pixel values are the exception design.md §1
      allows — in a glyph the value *is* the content.
    */
    icon: () => (
      <span aria-hidden="true" className="grid grid-cols-[7px_7px] gap-[3px]">
        <span className="block size-[7px] rounded-[1.5px] bg-current" />
        <span className="block size-[7px] rounded-full bg-current opacity-80" />
        <span className="block size-[7px] rounded-[1.5px] bg-current opacity-45" />
        <span className="block size-[7px] rounded-[1.5px] bg-current opacity-25" />
      </span>
    ),
  },
  {
    to: '/you',
    label: 'You',
    match: ['/you'],
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
          const isActive = tab.match.some((prefix) => pathname.startsWith(prefix))
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
