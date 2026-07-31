import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
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
 * **It only pays off if the restore finishes before the guard runs**, which it did not until
 * `App.tsx` grew its `RestoreGate` — the guard fetched over the network on every launch and this
 * entry bought nothing. See the block comment there; `startup.test.tsx` pins it.
 *
 * The objection to caching `/me` is that a stale space list is dangerous. It is stale-data-shaped,
 * not a security hole: authorization is server-side on every read and write
 * (security-model.md §1(3)), so the client's copy only decides what it *asks* for, never what it is
 * granted. Staleness is the thing ADR-0013 requires us to label rather than hide — see
 * `components/OfflineNotice.tsx`, which derives the age it shows from the oldest `dataUpdatedAt` in
 * the restored cache.
 */
/**
 * **`things` widens debt D47 rather than creating a new decision.** ADR-0029 §*Consequences* states
 * it: a thing's `serial` is returned on every response including the list, exactly as a document's
 * `identifier` is (ADR-0027), so a phone that has opened Things now holds every serial — an IMEI, a
 * registration, a hallmark — in **plaintext** on disk. Same class of data, same accepted trade, one
 * more domain of it. Nothing here is encrypted and no copy in the app may claim it is (debt D44).
 */
/**
 * **`reminders` was on this list and is gone, because no query is rooted at it.**
 *
 * Reminders arrive *nested* inside a document's and a thing's detail response, so they were already
 * persisted as part of `['documents', 'detail', id]` and the entry bought nothing. What it would have
 * done is the opposite of what an allowlist is for: the next session to write a `['reminders', …]`
 * hook would have found its data silently on disk without anyone deciding that it should be. The
 * inventory of query roots the app actually has is documents · things · me · outbox · health · push,
 * and `offline.test.ts` fails if a root here is not one of them.
 *
 * Exported for that test.
 */
export const PERSISTED_KEY_ROOTS = new Set(['documents', 'things', 'me'])

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Once the cache has been purged, WRITES stop until a new session begins.
 *  Without this the file comes back about a second after every sign-out. Measured.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `throttleTime` below does not delay a write — it keeps **one queued write** and executes it
 * `throttleTime` after the previous one finished (`asyncThrottle`, in the persister package). So at
 * any moment during a live session there is very likely a write already scheduled, holding a
 * reference nothing here controls. `purgePersistedCache()` deletes the key; the queued write then
 * lands and re-creates it.
 *
 * Measured on the real provider tree: purge at +501ms, file back at **+1448ms** — 87 bytes of
 * `{buster, timestamp, clientState:{queries:[],mutations:[]}}`, no user data. Empty because
 * `endSession` clears the query client *before* deleting the file, and `asyncThrottle` executes with
 * the **latest** snapshot rather than the one that queued the write, so `clear()`'s own cache events
 * overwrite the payload first. That is three separate accidents deep — synchronous cache
 * notification, eager `dehydrate`, and `lastArgs` — and if any one of them changes, the same line
 * starts writing the previous user's documents back to disk after they signed out. Which is exactly
 * the failure security-model.md §4 puts "another user of the system" in the threat model for.
 *
 * So rather than depend on the payload being harmless, the write is refused outright.
 *
 * **Reads are deliberately untouched.** The seal is about `setItem`, never `getItem`: the restore
 * path is what D49 was about, and an app that cannot read its cache renders nothing at all.
 * `removeItem` is untouched too — it is how `persistQueryClientRestore` discards a busted cache, and
 * sealing on it would switch persistence off for a whole session every time a deploy changes the
 * buster.
 */
let sealed = false

export const queryCachePersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => (await get<string>(key)) ?? null,
    setItem: async (key, value) => {
      // Not an error and not logged: a write arriving after a purge is expected, once, every time.
      if (sealed) return
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

/**
 * NOTE: there was a `persistedCacheAge()` here, described as "used to label stale data". Nothing
 * called it. `OfflineNotice` computes the age it shows from the oldest `dataUpdatedAt` across the
 * live query cache instead, which is the better source — it dates the *data on screen* rather than
 * the moment the file was last written. Removed rather than kept, because an exported helper that
 * names a requirement reads as the thing implementing it.
 */

/**
 * Deletes the persisted cache outright.
 *
 * **Called on sign-out, and again on sign-in.** Sign-out is the case that matters; sign-in is the
 * belt-and-braces one, covering a sign-out that never completed — a tab closed mid-request, or a
 * session that expired server-side so no client-side sign-out ever ran. Without it, signing in as a
 * second user on a shared device would rehydrate the first user's documents before the first fetch
 * returned, and they would be visible on screen.
 *
 * **Seals writes, and the seal is set BEFORE the delete, not after.** A queued write can execute
 * between the two statements otherwise, which is the whole hazard. See `sealed` above; `resume-
 * Persisting()` below is the only way back.
 */
export async function purgePersistedCache(): Promise<void> {
  sealed = true
  await del(CACHE_KEY)
}

/**
 * Lets the cache be written again, after a purge.
 *
 * **Called from exactly one place — `beginSession`, at the very end of it** — and the position is the
 * point rather than a detail:
 *
 *  - **Not at the start.** `beginSession` purges *before* it clears, so unsealing first would be
 *    undone by its own purge a line later and persistence would stay off for the whole session.
 *  - **Not between the purge and `clear()`.** That is the window a write queued by the *previous*
 *    session executes in, and its payload at that instant is still the previous user's dehydrated
 *    cache. Unsealing there would let the one dangerous write through.
 *  - **After `clear()` and the `me` invalidation**, so the first thing that reaches disk belongs to
 *    the user who just signed in. Nothing is lost by waiting: `persistClient` re-dehydrates the whole
 *    cache on every cache event, so the next fetch to settle rebuilds the file.
 *
 * **Sign-out deliberately has no counterpart.** After `endSession` the app is on `/login` with an
 * empty query client, so there is nothing worth persisting, and leaving writes off until somebody
 * signs in is the safer of the two defaults. `hardRecovery()` has no counterpart either, for a
 * stronger reason: it purges *because this client is not to be trusted*, and if its `location.reload()`
 * somehow does not land, re-persisting from the client we just condemned is precisely the D46 failure.
 * A page load resets this module, so both cases recover on their own.
 */
export function resumePersisting(): void {
  sealed = false
}

export const MAX_AGE = MAX_AGE_MS
