import { z } from 'zod'

/**
 * The library's three scopes. [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * ── Why `all` is the default, and why the pills are not navigation ──
 *
 * `all` first, because the merged list is the whole reason the tab exists: opening it on Documents
 * would make Things the thing you have to go and find, which is the failure ADR-0031 reversed the
 * switcher over. The comp's own `libDefault` knob defaults to `all` too.
 *
 * The scope lives in the **URL**, so a filtered library has an address — the Now screen's no-scan
 * nudge deep-links into `?scope=documents&scan=no`, and a back-navigation from a document returns to
 * the scope the user was reading rather than resetting to All.
 *
 * But the pills that set it are `<button>`s, not `<Link>`s, and that is deliberate rather than the
 * mistake design.md §8 names. That rule governs *navigation between places*: a tab is a destination
 * and must carry an href. A scope pill filters the list you are already looking at — same route, same
 * screen, one search param — and `aria-pressed` is the correct announcement for a control that
 * narrows a view. Making them links would put four addresses for one place in the history stack, so
 * Back would walk the user pill by pill instead of leaving the library.
 */
export const libraryScopeSchema = z.enum(['all', 'documents', 'things'])
export type LibraryScope = z.infer<typeof libraryScopeSchema>

export const SCOPE_LABELS: Record<LibraryScope, string> = {
  all: 'All',
  documents: 'Documents',
  things: 'Things',
}

/**
 * The screen's title per scope — *"Everything"*, not *"All"*.
 *
 * The pill and the heading say different words on purpose. "All" is the right label on a pill sitting
 * beside "Documents" and "Things", because it is answering *which of these*. "Everything" is the right
 * heading because it names the place, and a page titled "All" says nothing about what it holds.
 */
export const SCOPE_TITLES: Record<LibraryScope, string> = {
  all: 'Everything',
  documents: 'Documents',
  things: 'Things',
}
