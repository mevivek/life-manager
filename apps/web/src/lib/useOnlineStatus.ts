import { useSyncExternalStore } from 'react'

/**
 * Whether the browser currently believes it has a network connection.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the value lives outside React, and
 * this is the API built for exactly that. It also gets the initial read right — an effect-based
 * version renders once with a guessed value before correcting itself, which would flash the offline
 * banner on every cold start.
 *
 * **`navigator.onLine` is a floor, not a guarantee.** `true` means an interface is up, not that the
 * API is reachable — captive portals and dead uplinks both report `true`. That is acceptable here
 * because this only drives *labelling*: a request that fails anyway surfaces its own error. It must
 * never be used to decide whether to attempt a request.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server snapshot: there is no SSR here, but `useSyncExternalStore` requires it for the
    // hydration path. Assume online so nothing renders an offline banner into static output.
    () => true,
  )
}
