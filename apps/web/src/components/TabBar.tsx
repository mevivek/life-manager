import { Link, useRouterState } from '@tanstack/react-router'
import { toLedger, useLedger } from '@/features/documents/useLedger'
import { cn } from '@/lib/utils'

/**
 * The bottom tab bar — persistent app chrome. ADR-0025 §4.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Three tabs, permanently visible, always labelled: Now · Documents · Add.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ── This replaces a plan to grow the bar one tab per domain ──
 *
 * The previous version of this file committed to `Home · Documents · Assets · Money` — the bar
 * "the shape M4 needs". **ADR-0025 reverses that, and the reversal is the load-bearing decision
 * here, not the styling.** Domains never become tabs. When assets, money, people and the vault
 * arrive, the *middle tab's title* becomes a domain switcher: one tap on "Documents ⌄" swaps the
 * collection under the same search, the same filters, the same row. Now stays a single cross-domain
 * deadline feed, because a car's MOT and a passport's expiry belong in one list — and that
 * cross-domain view is the whole reason the dashboard exists.
 *
 * Why not five or six tabs: at two-week intervals the user relearns the bar every time they open the
 * app. Three labelled tabs is one glance. Tab count stays three at six domains.
 *
 * **The switcher does not exist yet, and must not be drawn yet** — one domain, no chevron. Honest,
 * never decorative: the control appears the day the second domain does.
 *
 * ── Add is a tab, not a floating button ──
 *
 * It is the third item rather than a FAB so it cannot be mistaken for decoration, and it carries the
 * ink fill because it is the one action available from every screen. It **opens a sheet rather than
 * navigating**: capture is a thing you do on top of what you were looking at, not a place you go.
 * `/documents/new` still exists as a real route for deep links.
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
 * glyph is three ruled lines of decreasing length and opacity (a ledger page), and the Documents
 * glyph is a bare 2px rectangle. Both are geometry rather than illustration, which is the point —
 * an icon set here would put a house and a folder in an app that is neither.
 */
const TABS: Tab[] = [
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
]

export function TabBar({ onAdd }: { onAdd: () => void }) {
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
       */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper pb-[max(env(safe-area-inset-bottom),1.625rem)]"
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

        <button
          type="button"
          onClick={onAdd}
          className="flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-[5px] rounded-2 bg-ink text-onink active:opacity-90"
        >
          <span aria-hidden="true" className="relative block size-4">
            <span className="absolute top-[7px] left-0 h-[2.5px] w-4 rounded-[1px] bg-current" />
            <span className="absolute top-0 left-[7px] h-4 w-[2.5px] rounded-[1px] bg-current" />
          </span>
          <span className="text-[12px] font-semibold">Add</span>
        </button>
      </div>
    </nav>
  )
}
