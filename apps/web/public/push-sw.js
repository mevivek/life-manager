/**
 * Push handling for the service worker.
 *
 * Imported into the generated worker via `workbox.importScripts` in `vite.config.ts`, rather than
 * switching vite-plugin-pwa to `injectManifest`. That keeps the precache manifest generated for us
 * — the `generateSW` strategy is doing its job correctly and there is no reason to take it over
 * just to add two event listeners.
 *
 * **Without this file, delivery silently does nothing.** `userVisibleOnly: true` means every push
 * MUST show a notification; a worker with no `push` listener gets the message, shows nothing, and
 * some browsers then display a generic "site updated in the background" notice instead. So the
 * whole reminder feature ends at this file: the scan job finds the reminder, the API encrypts and
 * sends it, and this is what the user actually sees.
 *
 * Plain JavaScript in `public/`, not TypeScript: it is copied verbatim and imported by the worker
 * at runtime, so it is never part of the app's module graph or its build.
 */

/* global self, clients */

self.addEventListener('push', (event) => {
  /**
   * The payload is JSON written by `apps/api/src/jobs/reminders.ts`:
   * `{ title, body, url }`. Wrapped in a try/catch because a push from anything other than our own
   * API — or a future change to the payload shape — must still show *something*: with
   * `userVisibleOnly` a silent failure here is worse than a generic notification.
   */
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || 'life-manager'
  const options = {
    body: payload.body || 'Something needs your attention.',
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    // Collapses repeats: several reminders for one document should not stack up as separate
    // notifications the user has to dismiss one by one.
    tag: payload.tag || 'life-manager-reminder',
    data: { url: payload.url || '/' },
  }

  // `waitUntil` keeps the worker alive until the notification is shown. Without it the worker can
  // be killed first and the notification never appears.
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const target = event.notification.data?.url || '/'

  event.waitUntil(
    (async () => {
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })

      // Focus an existing tab rather than opening a duplicate. A person who taps a reminder while
      // the app is already open expects to land in it, not to get a second copy.
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus()
          if ('navigate' in client) await client.navigate(target)
          return
        }
      }

      await clients.openWindow(target)
    })(),
  )
})
