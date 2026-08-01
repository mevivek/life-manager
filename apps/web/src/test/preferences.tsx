import { FEEL_STORAGE_KEYS } from '@/lib/feel'
import { FeelProvider } from '@/lib/useFeel'

/**
 * Render helpers for the device preferences, so a suite can exercise the **non-default** half.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A test that needs no wrapper is testing the default. That is deliberate, not laziness.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `useFeel` outside a provider returns `DEFAULT_FEEL` rather than throwing (see its own note — a
 * dozen component tests render one component with no app shell, and taxing every one of them to
 * read one preference buys nothing). So every existing test is already asserting the default
 * behaviour, and only the tests that want the other setting reach for this.
 */

/**
 * The app with **numbers hidden** — ADR-0036's opt-in mask.
 *
 * Written to `localStorage` before the provider mounts, because `FeelProvider` seeds its state from
 * `readFeel()` during the first render rather than in an effect: that is what stops a compact user's
 * first frame rendering generous, and it means a `set()` after mount would be a second render this
 * helper does not need.
 *
 * The shared `afterEach` in `test/setup.ts` clears `localStorage`, so the preference cannot leak into
 * the next test — which matters more here than for most state, because a leaked `hidden` would turn
 * "shows the number" into a passing test of the wrong thing.
 */
export function withNumbersHidden(ui: React.ReactElement) {
  localStorage.setItem(FEEL_STORAGE_KEYS.numbers, 'hidden')
  return <FeelProvider>{ui}</FeelProvider>
}
