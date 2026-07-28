import { Link, useRouterState } from '@tanstack/react-router'
import { cn } from '@/lib/utils'

/**
 * The bottom tab bar — persistent app chrome.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why a tab bar rather than links in a header
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Before this, the app had **no persistent navigation at all**: moving between the dashboard and
 * the document list meant a text link in a header row, and moving back meant the browser's back
 * button. That is the single loudest signal that something is a web page rather than an app, and
 * no amount of styling elsewhere compensates for it.
 *
 * **Two tabs is thin today and that is deliberate.** `Home` is specified as a cross-domain
 * dashboard (product/idea-backlog.md: "grows into a cross-domain view as domains land"), so the
 * bar is the shape M4 needs — Home · Documents · Assets · Money — rather than something to be
 * replaced then. Adding a domain adds an entry.
 *
 * **`Add` is an action, not a destination**, so it is styled as the primary affordance rather than
 * as a third peer tab. It is in the bar because capture friction is the risk Q2 traded against
 * (product/brain.md principle 2) and "always one tap away" is what that answer implies.
 */

type Tab = {
  to: string
  label: string
  /** Matches this tab as active when the pathname starts with it. */
  match: string
  icon: React.ReactNode
}

/**
 * Inline SVGs rather than `lucide-react` components.
 *
 * `lucide-react` is already a dependency and is used elsewhere, but these are the only icons that
 * render on every single screen — inlining them keeps them out of the render path of a library
 * lookup and lets each one carry the exact stroke weight the bar needs.
 */
const TABS: Tab[] = [
  {
    to: '/home',
    label: 'Home',
    match: '/home',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 10.5 12 3l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    to: '/documents',
    label: 'Documents',
    match: '/documents',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path
          d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
          strokeLinejoin="round"
        />
        <path d="M14 3v5h5" strokeLinejoin="round" />
      </svg>
    ),
  },
]

export function TabBar() {
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  return (
    <nav
      aria-label="Main"
      /**
       * `fixed` with the safe-area inset as *padding*, not margin: the bar's background must extend
       * behind the home indicator, or there is a strip of page showing beneath it. This is why the
       * inset was removed from `body` in styles.css.
       *
       * `backdrop-blur` over a translucent background is the detail that makes content scrolling
       * underneath read as depth rather than as a gap.
       */
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/85 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex h-16 w-full max-w-2xl items-stretch justify-around px-2">
        {TABS.map((tab) => {
          const isActive = pathname.startsWith(tab.match)
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors',
                // `active:` gives the press feedback that removing -webkit-tap-highlight-color took
                // away. Without it, taps would feel dead.
                'active:bg-secondary',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <span className="size-6">{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}

        <Link
          to="/documents/new"
          aria-label="Add a document"
          className="flex flex-1 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors active:opacity-70"
        >
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              className="size-5"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
          </span>
          Add
        </Link>
      </div>
    </nav>
  )
}
