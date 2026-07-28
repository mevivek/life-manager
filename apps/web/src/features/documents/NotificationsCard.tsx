import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { api } from '@/lib/api'

/**
 * Enables Web Push for this browser, so reminders actually arrive.
 *
 * This is the half of M1's "done when" that lives in the client: *"your phone notifies you before
 * one expires."* Without a subscription the scan job runs, finds the reminder, and has nowhere to
 * send it — which it logs as a warning rather than failing silently.
 *
 * ── Why this renders nothing when push is unconfigured ──
 *
 * `GET /api/v1/push/public-key` returns `null` rather than a 503 precisely so this card can
 * disappear instead of offering a button that fails. A deployment without VAPID keys is a normal
 * state, not an error.
 *
 * **The component owns its own `Card`** for exactly that reason. With the card in the parent, an
 * unconfigured deployment rendered an empty bordered box with a heading and nothing in it, which
 * reads as a broken panel rather than an absent feature.
 *
 * ── Three separate "no" states, deliberately distinguished ──
 *
 * The server has no key · the browser has no Push API · the user denied permission. Collapsing them
 * into one "notifications unavailable" message would make the only actionable one (denied
 * permission, which the user can reverse in site settings) unrecoverable.
 */
export function NotificationsCard() {
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const publicKey = useQuery({
    queryKey: ['push', 'public-key'],
    queryFn: api.push.publicKey,
    // The key does not change; refetching it on every focus is pure noise.
    staleTime: Number.POSITIVE_INFINITY,
  })

  const subscribe = useMutation({
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
    onSuccess: () => setDone(true),
    onError: (caught) =>
      setError(caught instanceof Error ? caught.message : 'Could not enable notifications.'),
  })

  // Push is not configured on this deployment — render nothing at all.
  if (publicKey.isPending || publicKey.data === null || publicKey.data === undefined) return null

  const supported =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

  if (!supported) {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          This browser cannot receive push notifications. Reminders are still visible in the app.
        </p>
      </Shell>
    )
  }

  if (done || Notification.permission === 'granted') {
    return (
      <Shell>
        <p className="text-sm text-muted-foreground">
          Notifications are on for this device. Reminders arrive before a document expires.
        </p>
      </Shell>
    )
  }

  const key = publicKey.data

  return (
    <Shell>
      <div className="flex flex-col gap-3">
        {error !== null && <Alert variant="destructive">{error}</Alert>}
        <p className="text-sm text-muted-foreground">
          Turn on notifications so this app can tell you before something expires. Without them,
          reminders only show up when you open the app.
        </p>
        <Button
          size="sm"
          className="self-start"
          disabled={subscribe.isPending}
          onClick={() => {
            setError(null)
            subscribe.mutate(key)
          }}
        >
          {subscribe.isPending ? 'Enabling…' : 'Enable notifications'}
        </Button>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/**
 * base64url → `Uint8Array`, which is what `applicationServerKey` requires.
 *
 * `atob` needs standard base64, and a VAPID public key is base64**url** without padding — so the
 * two character substitutions and the padding are both mandatory. Getting this wrong produces an
 * `InvalidCharacterError` or, worse, a subscription the push service silently rejects later.
 */
function base64UrlToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)

  /**
   * Backed by an explicit `ArrayBuffer`, not `new Uint8Array(length)`.
   *
   * Under TypeScript 5.7+ the latter is `Uint8Array<ArrayBufferLike>`, which is not assignable to
   * `BufferSource` — `ArrayBufferLike` includes `SharedArrayBuffer`, and `applicationServerKey`
   * will not take one. Allocating the buffer first pins the type.
   */
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}
