import { purgePersistedCache } from './persister'

/**
 * Recovery from a client that is OLDER than the origin it is talking to.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A stale client cannot fix itself with `location.reload()`. That is the whole problem.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ── The failure this exists for, as it actually happened ──
 *
 * Three deploys landed in quick succession. A phone was still running an `index.html` from the
 * first — served from the service worker's precache, which `navigateFallback: '/index.html'` makes
 * the answer to every navigation, reload included. That HTML names hashed chunks, and one of them
 * (`/assets/_authed-B5PBI_a-.js`) no longer exists on the origin. The origin's SPA fallback
 * (`public/_redirects`, `/* /index.html 200`) answers a missing path with the app's own HTML at
 * status **200**, so the dead chunk did not 404 — it came back as `text/html`, and a
 * `<script type="module">` refuses to execute HTML:
 *
 *     'text/html' is not a valid JavaScript MIME type for module script
 *
 * The root error boundary caught it and offered **Reload**, which fetched the same precached HTML
 * and asked for the same dead chunk. A loop with no exit but clearing site data or deleting the
 * installed PWA — on a phone, from a user who cannot be told to open devtools.
 *
 * ── Why the sequence below yields FRESH html, and a bare reload does not ──
 *
 * Three independent mechanisms can serve the stale document. All three have to be dislodged, and
 * each step here answers one:
 *
 *  1. **The service worker's precache.** `unregister()` sets the registration's *uninstalling* flag,
 *     and the Service Workers spec's *Match Service Worker Registration* skips registrations with
 *     that flag set. So the reload's navigation matches no registration, is not controlled by any
 *     worker, and goes to the network. This is the step that actually breaks the loop.
 *  2. **The precache contents, in case (1) is somehow still in play.** Emptying Cache Storage means
 *     Workbox's `PrecacheStrategy` finds no entry for `/index.html`; its `fallbackToNetwork` default
 *     is `true`, so even a still-controlling worker fetches the document from the network. A second
 *     belt, deliberately, because (1) depends on spec behaviour we cannot observe from here.
 *  3. **The browser's own HTTP cache.** Not ours to clear, and not ours to worry about:
 *     `location.reload()` revalidates the top-level document rather than reusing a cached copy. This
 *     is the belt that covers the variant of the bug with no service worker involved at all.
 *
 * Note what is **not** here: `registration.update()`. It re-fetches `sw.js` and can install a new
 * worker, but installing one does nothing for the document *this* load already has — and with
 * `registerType: 'autoUpdate'` the new worker's activation makes vite-plugin-pwa call
 * `location.reload()` itself (debt D51), so calling `update()` would race our reload with its own.
 * Unregistering is both sufficient and unambiguous; `main.tsx` registers a fresh worker on the way
 * back up.
 *
 * **And that fresh registration does not add a second reload**, which is worth stating because D51
 * says a new worker's activation reloads the page. It does not here: vite-plugin-pwa reloads only
 * `if (event.isUpdate || event.isExternal)`, and workbox-window sets `_isUpdate` from
 * `Boolean(navigator.serviceWorker.controller)` when it registers. After the unregister the reloaded
 * page is *uncontrolled*, so there is no update to reload for — this is a first install, not a swap.
 *
 * ── Why the persisted Query cache goes too ──
 *
 * Debt **D46** is the precedent: the IndexedDB Query cache is rehydrated **without re-running Zod**,
 * so a cache written by an older build can hand a component last week's response shape and crash the
 * app at its root error boundary. "The client is older than it thinks it is" is exactly that
 * situation, so the on-disk cache is not to be trusted across this recovery. It is a cache; losing it
 * costs one round trip, and `purgePersistedCache()` is the one purge path (`lib/persister.ts`).
 */

/**
 * The loop guard's key. **`sessionStorage`, not `localStorage`, and that is the point.**
 *
 * The guard has to survive the reload — the loop being prevented is *stale HTML → dead chunk →
 * recover → reload → stale HTML again* — so it cannot live in a module variable. But it must not
 * outlive the tab either: a genuinely broken deploy would otherwise leave a device permanently
 * unable to attempt recovery, long after the deploy was fixed. `sessionStorage` is scoped to exactly
 * the right lifetime, and its per-tab scope means a second tab still gets its own attempt.
 */
const RECOVERY_ATTEMPTED_KEY = 'life-manager-stale-client-recovery'

/**
 * Takes the one automatic attempt this tab is allowed, or refuses.
 *
 * Returns `false` if the attempt was already spent **or if the guard cannot be written at all**
 * (Safari private browsing, storage disabled). Refusing when we cannot record the attempt is
 * deliberate: without a durable guard there is nothing to stop a reload loop, and a phone stuck
 * reloading forever is strictly worse than a phone showing an error message with a button on it.
 * The button still works — a tap is a decision, and a decision cannot loop.
 */
function claimTheOneAutomaticAttempt(): boolean {
  try {
    if (window.sessionStorage.getItem(RECOVERY_ATTEMPTED_KEY) !== null) return false
    window.sessionStorage.setItem(RECOVERY_ATTEMPTED_KEY, new Date().toISOString())
    return true
  } catch {
    return false
  }
}

/**
 * Runs one step, and never lets its failure abandon the rest.
 *
 * Each step is independent, and a recovery that gives up half way through leaves the user exactly
 * where they were: in the loop. The failure is **reported, never swallowed** — a partial recovery is
 * how "I pressed Reload and nothing happened" becomes unexplainable. `console.error` is the only
 * console level `biome.json` allows, and this app has no Rollbar.
 */
async function step(what: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    console.error(`[recovery] could not clear ${what}`, error)
  }
}

/** Empties Cache Storage — the service worker's precache, and anything else Workbox put there. */
async function deleteEveryCache(): Promise<void> {
  // Guarded rather than assumed: `caches` is absent from jsdom, and from any insecure context.
  if (!('caches' in window)) return
  const keys = await window.caches.keys()
  await Promise.all(keys.map((key) => window.caches.delete(key)))
}

/** Uninstalls every service worker for this origin, which is what un-controls the next navigation. */
async function unregisterEveryServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((registration) => registration.unregister()))
}

/**
 * Throws away everything cached about this build and reloads from the network.
 *
 * Called from two places, and both of them matter: automatically on `vite:preloadError` (see
 * `installStaleChunkRecovery`), and from the **Reload** button on the root error boundary, which
 * before this could not do what its label said (`routes/__root.tsx`).
 *
 * Order is deliberate. The Query cache goes first because it is the only step that touches user
 * data and the only one whose failure is worth knowing about before the page disappears; the service
 * worker goes last because unregistering it is what makes the reload count.
 *
 * Deliberately does **not** consult the loop guard: this function is also the button's handler, and a
 * tap is one deliberate act per tap. Concurrent runs are harmless — every step is an idempotent
 * delete.
 */
export async function hardRecovery(): Promise<void> {
  await step('the persisted query cache', () => purgePersistedCache())
  await step('cache storage', deleteEveryCache)
  await step('the service worker', unregisterEveryServiceWorker)
  window.location.reload()
}

/**
 * Listens for Vite's `vite:preloadError` and recovers **once** per tab.
 *
 * Vite dispatches this cancelable event on `window` when a dynamic import or one of its
 * `modulepreload` dependencies fails, and rethrows the error only `if (!e.defaultPrevented)` — see
 * `handlePreloadError` in Vite's generated preload helper. So `preventDefault()` is the documented
 * way to say "handled", and it is called on the attempt we take: the reload is already in flight, and
 * letting the original error propagate as well only puts a second, more confusing message on screen
 * during the moment before the page goes away.
 *
 * On an attempt we **decline** — the guard is already spent, so this is a second failure in the same
 * tab and reloading again would be a loop — `preventDefault()` is pointedly *not* called. The error
 * is allowed to throw, the root error boundary catches it, and the user gets the real message and a
 * Reload button that now performs the same hard recovery deliberately.
 *
 * Returns its own unsubscribe, which production drops on purpose: this lives as long as the page.
 */
export function installStaleChunkRecovery(): () => void {
  /**
   * Local to the installation, not module-level, so a test that installs a listener gets a clean
   * one. It exists because a single failed import can dispatch the event more than once — Vite
   * reports every rejected dependency, and then the module load itself — and suppressing the extras
   * keeps a recovery already under way from surfacing errors about the tree it is abandoning.
   */
  let recovering = false

  const onPreloadError = (event: VitePreloadErrorEvent) => {
    if (recovering) {
      event.preventDefault()
      return
    }
    if (!claimTheOneAutomaticAttempt()) return

    recovering = true
    event.preventDefault()
    void hardRecovery()
  }

  window.addEventListener('vite:preloadError', onPreloadError)
  return () => {
    window.removeEventListener('vite:preloadError', onPreloadError)
  }
}
