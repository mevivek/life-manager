import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import { del, get, set } from 'idb-keyval'

/**
 * Persists the TanStack Query cache to IndexedDB, which is what makes the app readable offline.
 *
 * This is [ADR-0013](../../../../docs/decisions/0013-read-only-offline-v1.md) as written: the
 * service worker precaches the app *shell*, and the *data* comes from here. Two things follow from
 * that split, and both look like omissions if you do not know the ADR:
 *
 *  - **There is deliberately no `runtimeCaching` entry for the API** in `vite.config.ts`, and
 *    `/api/*` is on the `navigateFallbackDenylist`. Caching API responses in the service worker as
 *    well would mean two overlapping copies of Tier 0 data, and the Cache Storage copy is the one
 *    that `signOut()` cannot clear as part of the Query lifecycle. One cache, one purge path.
 *  - **Downloaded files are not cached.** ADR-0013 rules it out for v1: they are large, and they
 *    are fetched from R2 by a presigned URL that expires anyway.
 *
 * ── Why this file is security-relevant ──
 *
 * Documents are Tier 0 (server-readable), and
 * [security-model.md](../../../../docs/security-model.md) §4 names the threat model Tier 0 defends
 * against: "a lost laptop, a stolen phone, a network attacker, and another *user* of the system".
 * Persisting the cache writes document titles, issuers and expiry dates to disk on the device, so
 * it moves data into exactly the place those first two threats reach. That is an accepted trade —
 * offline read access is close to the point of the app — but it makes two rules non-negotiable:
 *
 *  1. **The cache must be purged on sign-out.** `queryClient.clear()` only empties memory. See
 *     `purgePersistedCache` below and its call site in the sign-out handler.
 *  2. **No secret may ever be dehydrated.** In particular presigned URLs, which
 *     [security-model.md](../../../../docs/security-model.md) §6 lists alongside tokens and
 *     session cookies as things never to log or store.
 */

/**
 * One key, not one per user.
 *
 * A per-user key would leave every previous user's cache sitting in IndexedDB under its own key,
 * which is worse: nothing would ever delete them. A single key that is purged on sign-out and again
 * on sign-in has no such residue.
 */
const CACHE_KEY = 'life-manager-query-cache'

/**
 * Bumped by the build, so a deploy that changes a response shape discards the old cache instead of
 * rehydrating data the new code cannot read.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This did not work, and the failure was silent until it crashed a real phone.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `__APP_VERSION__` is `process.env.VITE_APP_VERSION ?? 'dev'` (`vite.config.ts`), and
 * **`VITE_APP_VERSION` was set nowhere** — not in `cloudbuild.deploy.yaml`, not in the Pages build.
 * So the buster was the literal string `'dev'` on every deploy, for every build, and therefore never
 * busted anything. A cache written weeks earlier rehydrated into whatever code shipped next.
 *
 * ADR-0026 then added a field to the document detail response. The old cached detail had no
 * `identifier` key, rehydration does **not** re-run Zod (validation is at the fetch boundary), and
 * `IdentifierCard` read `.length` off it: *"undefined is not an object"* at the root error boundary,
 * app unusable, on the maintainer's phone within an hour of the deploy.
 *
 * `CF_PAGES_COMMIT_SHA` is what Cloudflare Pages sets on every build, so it changes exactly when the
 * code does. `VITE_APP_VERSION` stays as an override for other hosts, and `'dev'` remains the local
 * fallback — a dev server rebuilding constantly does not want its cache dropped every reload.
 *
 * **A cache buster that cannot be observed to change is not a cache buster**, and nothing checks that
 * this one does — a unit test cannot, because the value is injected at build time and Vitest injects
 * its own. Debt **D46**: the check belongs in `scripts/verify-deployment.mjs`, which already greps the
 * shipped bundle for `VITE_API_URL` for exactly this class of "configured wrong, looks fine" bug.
 *
 * Until then the second line of defence is that **components must tolerate a stale shape** — see the
 * prop note on `IdentifierCard`, and the tests named "survives a document cached by an older build".
 */
const CACHE_BUSTER = __APP_VERSION__

/**
 * Cached data older than this is discarded rather than shown.
 *
 * A week is chosen against the actual use case: a passport number in a queue with no signal. Beyond
 * that the reading is more likely to mislead than help — an expiry date that has since been renewed
 * is worse than an empty screen, because the user cannot tell it is old.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Which query keys may be written to disk. **Allowlist, not denylist** — the inverse would mean any
 * future hook is persisted by default, and the first one holding something sensitive would leak it
 * silently. Adding a key here is a deliberate act.
 *
 * **`me` is load-bearing, not a convenience.** `routes/_authed.tsx` guards the whole authed area
 * with `ensureQueryData({ queryKey: meQueryKey })`, and rethrows anything that is not a 401. With
 * `me` absent from the cache, an offline launch fails that call on the network error and lands on
 * the root error screen — so every other persisted query would be unreachable and this whole file
 * would buy nothing. `ensureQueryData` returns rehydrated data without a fetch, which is precisely
 * what makes an offline cold start work.
 *
 * The objection to caching `/me` is that a stale space list is dangerous. It is stale-data-shaped,
 * not a security hole: authorization is server-side on every read and write
 * (security-model.md §1(3)), so the client's copy only decides what it *asks* for, never what it is
 * granted. Staleness is the thing ADR-0013 requires us to label rather than hide — see
 * `StaleNotice`.
 */
const PERSISTED_KEY_ROOTS = new Set(['documents', 'reminders', 'me'])

export const queryCachePersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get<string>(key)) ?? null,
    setItem: async (key, value) => {
      await set(key, value)
    },
    removeItem: async (key) => {
      await del(key)
    },
  },
  key: CACHE_KEY,
  // Every keystroke in the search box is a new query key; without throttling this writes the whole
  // cache to IndexedDB on each one.
  throttleTime: 1_000,
})

/**
 * Passed as `persistOptions.buster`, NOT to `createAsyncStoragePersister` — the persister has no
 * such option and silently accepting one would mean the cache was never busted at all.
 */
export const cacheBuster = CACHE_BUSTER

/**
 * What may be written to disk, and what may not.
 *
 * Passed to `PersistQueryClientProvider` as `persistOptions.dehydrateOptions`.
 */
export const dehydrateOptions = {
  /**
   * Only successful queries whose root key is allowlisted. Errors are excluded deliberately: a
   * persisted 500 would be replayed as a hard failure on next launch, offline, with no way for the
   * user to retry past it.
   */
  shouldDehydrateQuery: (query: { queryKey: readonly unknown[]; state: { status: string } }) => {
    if (query.state.status !== 'success') return false
    const [root] = query.queryKey
    return typeof root === 'string' && PERSISTED_KEY_ROOTS.has(root)
  },

  /**
   * **Never persist a mutation.** This enforces ADR-0013's "writes require connectivity" at the
   * storage layer rather than trusting every future call site to opt out: a persisted paused
   * mutation *is* an offline write queue, which the ADR rejects as actively dangerous ("a queued
   * write that appears to succeed and then loses data is worse than a write that plainly failed").
   *
   * It also closes the presigned-URL hole. `useDownload` and `useUploadFile` are mutations whose
   * results contain short-lived signed R2 URLs; returning `false` here means those never reach
   * disk, per security-model.md §6.
   */
  shouldDehydrateMutation: () => false,
}

/** How old the restored cache is, or `null` when nothing was restored. Used to label stale data. */
export async function persistedCacheAge(): Promise<number | null> {
  const raw = await get<string>(CACHE_KEY)
  if (raw === undefined) return null
  try {
    const parsed: PersistedClient = JSON.parse(raw)
    return typeof parsed.timestamp === 'number' ? Date.now() - parsed.timestamp : null
  } catch {
    // A cache we cannot parse is a cache we cannot date. Not an error path worth surfacing — the
    // persister will overwrite it on the next write — but it must not throw into a render.
    return null
  }
}

/**
 * Deletes the persisted cache outright.
 *
 * **Called on sign-out, and again on sign-in.** Sign-out is the case that matters; sign-in is the
 * belt-and-braces one, covering a sign-out that never completed — a tab closed mid-request, or a
 * session that expired server-side so no client-side sign-out ever ran. Without it, signing in as a
 * second user on a shared device would rehydrate the first user's documents before the first fetch
 * returned, and they would be visible on screen.
 */
export async function purgePersistedCache(): Promise<void> {
  await del(CACHE_KEY)
}

export const MAX_AGE = MAX_AGE_MS
