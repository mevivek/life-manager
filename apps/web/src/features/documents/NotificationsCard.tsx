import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ExpiryGlyph, formatDate } from './ExpiryStatus'
import { pushSupported, usePushPublicKey, useSubscribeToPush } from './usePush'

/**
 * The push ask, and the three ways push is not available. ADR-0025 §6.
 *
 * This is the half of M1's "done when" that lives in the client: *"your phone notifies you before one
 * expires."* Without a subscription the scan job runs, finds the reminder, and has nowhere to send it
 * — which it logs as a warning rather than failing silently.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Four states, and each one is a different kind of "no"
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 *  - **No keys** — the server has no VAPID key. **The feature vanishes entirely**: no card, no
 *    toggle, no greyed-out row, no mention of notifications anywhere. The user never learns that a
 *    feature exists which cannot work. `GET /push/public-key` returns `null` rather than a 503
 *    precisely so this state is expressible.
 *  - **Unsupported** — the browser has no Push API. One muted line suggesting install-to-home-screen,
 *    and **no button**, because there is nothing to tap that would help.
 *  - **Denied** — recoverable, so it says *where*: the literal Settings path, plus the honest
 *    fallback that this screen is the reminder until then. Re-read on every render, so the card
 *    disappears the moment the permission flips.
 *  - **Ask** — earned, never on arrival. See below.
 *
 * Collapsing these into one "notifications unavailable" message would make the only actionable one
 * unrecoverable.
 *
 * ── The ask is earned ──
 *
 * It appears only once there is a document with an expiry date, so the prompt names a **real date the
 * user just typed** rather than asking for permission in the abstract. `expiresOn` being a required
 * prop is what enforces that: the component cannot render without one.
 *
 * "Not now" hides it permanently. That is not a soft dismissal — reminders still exist and still show
 * on this screen; what the user declined is the *notification*, and asking again later would be
 * nagging about a thing they already answered.
 */

const DISMISSED_KEY = 'life-manager-push-ask-dismissed'

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Private-mode Safari throws rather than returning null. Showing the ask is the safe default.
    return false
  }
}

export function NotificationsCard({
  /** The soonest real expiry, so the ask can name it. Null means there is nothing to ask about. */
  expiresOn,
  title,
}: {
  expiresOn: string | null
  title: string | null
}) {
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(wasDismissed)
  const [granted, setGranted] = useState(false)

  // The flow lives in `usePush` now, because You has a Turn on button too and two copies of the
  // permission-and-VAPID dance is two chances to get one of them subtly wrong.
  const publicKey = usePushPublicKey()

  const subscribe = useSubscribeToPush()
  const run = (key: string) =>
    subscribe.mutate(key, {
      onSuccess: () => setGranted(true),
      onError: (caught) =>
        setError(caught instanceof Error ? caught.message : 'Could not enable notifications.'),
    })

  // ── No keys: the feature does not exist on this deployment. ──
  if (publicKey.isPending || publicKey.data === null || publicKey.data === undefined) return null

  const supported = pushSupported()

  // ── Unsupported: one quiet line, no call to action. ──
  if (!supported) {
    return (
      <Alert variant="notice" className="[text-wrap:pretty]">
        This browser can’t do notifications. Add Life Manager to your home screen and open it from
        there, or check back — dates live on this screen either way.
      </Alert>
    )
  }

  // ── Denied: recoverable, so name the path. ──
  if (Notification.permission === 'denied') {
    return (
      <Card tone="soon" className="p-card">
        <div className="flex gap-2.5">
          <ExpiryGlyph state="expired" className="mt-1 text-status-soon" />
          <div>
            <p className="text-row font-medium leading-snug">Notifications are blocked</p>
            <p className="mt-1 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
              Reminders are set, but your phone won’t deliver them. Settings → Notifications → Life
              Manager → Allow.
            </p>
            <p className="mt-2 text-meta text-ink-3">Until then, this screen is the reminder.</p>
          </div>
        </div>
      </Card>
    )
  }

  /**
   * ── Granted: the card disappears. ──
   *
   * The previous version kept a permanent "Notifications are on for this device" panel here. It is
   * gone on purpose: a card reporting a setting the user cannot act on costs a scroll on every visit
   * forever. Once push works, the notifications themselves are the feedback.
   */
  if (granted || Notification.permission === 'granted') return null

  // ── Nothing to ask about yet, or already answered. ──
  if (expiresOn === null || dismissed) return null

  const key = publicKey.data

  return (
    <Card className="p-card">
      {error !== null && <Alert className="mb-3">{error}</Alert>}
      <p className="text-row font-medium leading-snug">
        Want us to tell you, or will you check back?
      </p>
      <p className="mt-1 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
        {/* The real document and the real date the user just typed. An abstract "enable
            notifications?" is the version people decline. */}
        {title === null ? 'A document' : title} expires {formatDate(expiresOn)}. We can send a
        notification 90, 30 and 7 days before.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          className="flex-1"
          size="sm"
          disabled={subscribe.isPending}
          onClick={() => {
            setError(null)
            run(key)
          }}
        >
          {subscribe.isPending ? 'Turning on…' : 'Turn on reminders'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            try {
              localStorage.setItem(DISMISSED_KEY, '1')
            } catch {
              // A dismissal that does not survive a reload is a far better outcome than a throw in a
              // click handler.
            }
            setDismissed(true)
          }}
        >
          Not now
        </Button>
      </div>
    </Card>
  )
}
