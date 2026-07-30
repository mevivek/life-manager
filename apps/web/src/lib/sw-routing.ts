/**
 * The service worker's navigation-fallback denylist, factored out of `vite.config.ts`.
 *
 * **This is build configuration, not shipped code.** Nothing in the app imports it at runtime, so it
 * never reaches the bundle. It lives under `src/` for one reason: `vitest.config.ts` collects only
 * `src/**`, and a constant no test can import is a constant nothing locks. `vite.config.ts` imports
 * it by relative path and hands it straight to Workbox.
 */

/**
 * Paths the service worker must never answer with `index.html`.
 *
 * `navigateFallback` exists so a deep link like `/documents/<id>` — a path with no file behind it —
 * gets the app shell instead of a 404. This denylist is where that generosity stops, and each entry
 * is here because answering with HTML is worse than failing outright:
 *
 *  - **`/api/`** — an API response served from the app shell is a JSON parse error at best. Worse, it
 *    would put a copy of Tier 0 data in Cache Storage, outside the single purge path
 *    `lib/persister.ts` owns (see the block comment in `vite.config.ts` about not adding
 *    `runtimeCaching` for the API).
 *
 *  - **`/assets/`** — hashed chunks. A stale client asks for a chunk a later deploy no longer builds;
 *    an `index.html` answer turns a clean 404 into *"'text/html' is not a valid JavaScript MIME type
 *    for module script"*, and the module never runs. The clean 404 is *recoverable* — Vite raises
 *    `vite:preloadError` and `lib/recovery.ts` acts on it — whereas HTML at status 200 is not,
 *    because nothing downstream can tell it from success.
 *
 * **Be honest about what this entry does and does not do.** `NavigationRoute` in workbox-routing
 * returns `false` immediately unless `request.mode === 'navigate'`, and a `<script type="module">`
 * request is `cors`/`no-cors`, never `navigate` — so the navigation fallback was never the mechanism
 * that served HTML for that chunk. This entry is a stated intent and a belt against a future
 * `runtimeCaching` or allowlist change, not the cure. The origin's own SPA fallback
 * (`public/_redirects`) is the one that actually returned the HTML, and it is still open — debt
 * **D56**, which records why it was left alone.
 */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [/^\/api\//, /^\/assets\//]
