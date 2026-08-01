import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * Turning reminders on and off, in one place.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Two screens ask for this now, so there is one implementation of it.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The Now screen's `NotificationsCard` owned the whole subscribe flow, which was right while it was
 * the only door. Handoff 5 gives You a **Turn on / Turn off** pair, and a second copy of
 * `Notification.requestPermission()` → `pushManager.subscribe()` → `api.push.subscribe()` is a second
 * chance to get the VAPID key decoding subtly wrong on one screen and not the other.
 */

/**
 * The server's VAPID public key, or `null` when this deployment has none.
 *
 * `null` means the feature does not exist here, and every caller must draw **nothing** rather than a
 * disabled control — a greyed-out reminders row teaches the user about a feature that cannot work.
 * `staleTime: Infinity` because the key does not change; refetching it on focus is pure noise.
 */
export function usePushPublicKey() {
  return useQuery({
    queryKey: ['push', 'public-key'],
    queryFn: api.push.publicKey,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Whether this browser can do web push at all. Three separate capabilities, all required. */
export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/**
 * Ask for permission, subscribe the service worker, register the subscription with the API.
 *
 * Throws with a readable message when permission is refused, because the caller renders it: "it
 * didn't work" with no reason sends the user to look for a setting they cannot find.
 */
export function useSubscribeToPush() {
  return useMutation({
    mutationFn: async (vapidPublicKey: string) => {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        throw new Error(
          'Notifications are blocked for this site. You can re-enable them in your browser’s site settings.',
        )
      }

      // The service worker is registered by vite-plugin-pwa; `ready` resolves once it controls the
      // page. Push subscriptions belong to the worker, not the page.
      const registration = await navigator.serviceWorker.ready

      const subscription = await registration.pushManager.subscribe({
        // Required to be true by every browser: a push that shows no notification is not allowed.
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(vapidPublicKey),
      })

      // `toJSON()` produces exactly the `{ endpoint, keys: { p256dh, auth } }` shape the API's
      // `pushSubscriptionSchema` validates.
      return api.push.subscribe(subscription.toJSON() as Parameters<typeof api.push.subscribe>[0])
    },
  })
}

/**
 * Turn reminders off — **client-side, and that is the complete fix rather than half of one.**
 *
 * ── There is no DELETE endpoint, and none is needed ──
 *
 * Unsubscribing the browser's `PushSubscription` makes the push service permanently discard that
 * endpoint. The API's daily scan already handles the consequence: `sendPush` returns `expired` on a
 * 404/410 and `jobs/reminders.ts` calls `markSubscriptionExpiredForMaintenance`, so the row disables
 * itself on the first send after this. Delivery stops **immediately** at the browser either way,
 * because the subscription it would be delivered to no longer exists.
 *
 * So the alternative — a `DELETE /api/v1/push/subscriptions/:id` — would buy a tidier row in the
 * database a few hours earlier, and would *not* change what the user experiences. It is worth adding
 * the day something reads that table for a count; it is not worth an endpoint today.
 *
 * Revoking the browser *permission* is deliberately not attempted: no web API can, it belongs to the
 * user's own settings, and pretending otherwise would make the button lie.
 */
export function useUnsubscribeFromPush() {
  return useMutation({
    mutationFn: async () => {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      // Already gone — this is a success, not an error. Turning off something already off is what
      // the user asked for, and reporting a failure would be a bug report about nothing.
      if (subscription === null) return
      await subscription.unsubscribe()
    },
  })
}

/**
 * Base64url → bytes, for `applicationServerKey`.
 *
 * Backed by an explicit `ArrayBuffer`, not `new Uint8Array(length)`. Under TypeScript 5.7+ the latter
 * is `Uint8Array<ArrayBufferLike>`, which is not assignable to `BufferSource` — `ArrayBufferLike`
 * includes `SharedArrayBuffer`, and `applicationServerKey` will not take one. Allocating the buffer
 * first pins the type.
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)

  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}
