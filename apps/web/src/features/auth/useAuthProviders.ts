import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * What this deployment can sign you in with — ADR-0035.
 *
 * The sign-in and sign-up screens are Google-only, which means they delete the email and password
 * fields. They may only do that once the *server* has said Google is registered: `auth.ts` builds
 * `socialProviders` as an empty object when `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are absent, and
 * nothing in the client build can see those. A screen that deleted the fields unconditionally would,
 * on a deployment without them, be one dead button and no way back in but a redeploy.
 *
 * **Not on the persist allowlist** (`lib/persister.ts`), deliberately. Capability is a property of the
 * server that is answering *now*, and a stale `google: true` read from disk after the credentials were
 * pulled would draw exactly the broken screen this exists to prevent.
 */
export const authProvidersQueryKey = ['auth', 'providers'] as const

export const authProvidersQueryOptions = queryOptions({
  queryKey: authProvidersQueryKey,
  queryFn: api.auth.providers,

  /**
   * `Infinity`. Whether a server has OAuth credentials cannot change while the page is open — it
   * changes on a redeploy, which reloads the app. Refetching on every window focus would be one
   * request per tab switch on a screen with nothing to refresh.
   */
  staleTime: Number.POSITIVE_INFINITY,

  /**
   * **`networkMode: 'offlineFirst'` is the anti-lockout setting, not a preference.**
   *
   * The client's default is `'online'` (see `lib/query-client.ts`), which *pauses* a fetch while
   * offline rather than failing it. Here that is the worst possible outcome: the query never settles,
   * so it is never `isError`, so the fallback below never runs and the sign-in screen shows its
   * loading skeleton forever. Same reasoning as `features/spaces/useMe.ts` — a query something
   * *blocks* on must fail fast rather than hang.
   *
   * `'offlineFirst'` tries once regardless and fails with an `OfflineError`, which is a state the
   * screen can act on.
   */
  networkMode: 'offlineFirst',
})

export function useAuthProviders() {
  return useQuery(authProvidersQueryOptions)
}

/**
 * Which of the three sign-in screens to draw.
 *
 * A union rather than a pair of booleans because the states are genuinely exclusive and the
 * *loading* one is not "google, but not yet" — ADR-0035: rendering the wrong screen for a beat is
 * worse than rendering nothing for a beat, because the wrong screen is one a user can start typing
 * into.
 */
export type AuthScreen =
  | { kind: 'loading' }
  | { kind: 'google' }
  /**
   * `googleUnconfigured` distinguishes the two ways in: `true` when the server *said* it has no
   * Google, `false` when we could not ask it. Only the first may be stated as a fact on screen —
   * saying "not configured on this server" because a request failed would be the app inventing a
   * diagnosis.
   */
  | { kind: 'password'; googleUnconfigured: boolean }

export function useAuthScreen(): AuthScreen {
  const { data, isError } = useAuthProviders()

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  THIS BRANCH IS THE ANTI-LOCKOUT GUARANTEE. It must stay ahead of the loading check.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *
   * Offline, or with the API down, the capability probe fails. Falling back to the password form is
   * the honest answer (ADR-0035): a Google redirect cannot work offline either, so the Google-only
   * screen would be a dead button — and leaving the skeleton up instead would lock the user out of
   * the *one* route that might still work, because a probe about configuration failed. The outage
   * this ADR exists to prevent, reintroduced from the client side.
   */
  if (isError) return { kind: 'password', googleUnconfigured: false }

  if (data === undefined) return { kind: 'loading' }

  return data.google ? { kind: 'google' } : { kind: 'password', googleUnconfigured: true }
}
