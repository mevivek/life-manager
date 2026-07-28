import { webcrypto } from 'node:crypto'
import { vapidConfig } from '../env.js'
import { logger } from './logger.js'

/**
 * Web Push delivery. RFC 8291 (message encryption) and RFC 8292 (VAPID).
 *
 * **`webpush-webcrypto`, not `web-push`.** The obvious package is `web-push`, and it is
 * deliberately not used: it is **MPL-2.0**, which is not on this project's allowed licence list
 * (Apache-2.0, MIT, BSD, ISC, CDDL, EPL). `webpush-webcrypto` is MIT, has zero dependencies, and
 * uses WebCrypto primitives.
 *
 * Writing this by hand was the other option and was rejected: message encryption is ECDH + HKDF +
 * AES-128-GCM, and CLAUDE.md invariant 8 says never hand-roll crypto. Composing those primitives
 * correctly is exactly the kind of thing that looks right and is subtly wrong.
 *
 * **The library needs WebCrypto handed to it explicitly.** It probes for a global it does not find
 * under Node 22 and throws `Could not find global Crypto module` — measured, not guessed. The
 * `setWebCrypto` call below is that fix, and it runs once at module load.
 */

/**
 * `webpush-webcrypto` ships no type declarations. They live in
 * `src/types/webpush-webcrypto.d.ts` — one file describing the three exports used here, rather
 * than `any` spread across call sites (conventions/code.md §5).
 */
import {
  ApplicationServerKeys,
  type ApplicationServerKeysJSON,
  generatePushHTTPRequest,
  setWebCrypto,
} from 'webpush-webcrypto'

setWebCrypto(webcrypto)

/** Cached across calls: deriving the key pair from JSON on every notification is pure waste. */
let keysPromise: Promise<ApplicationServerKeys> | undefined

export type PushTarget = { endpoint: string; p256dh: string; auth: string }

export type PushOutcome =
  | { status: 'sent' }
  | { status: 'not-configured' }
  /** The subscription is permanently gone (404/410). The caller must stop retrying it. */
  | { status: 'expired' }
  /** Anything else — possibly transient, so the caller should leave `sent_at` null and retry. */
  | { status: 'failed'; detail: string }

/**
 * Sends one notification.
 *
 * Returns an outcome rather than throwing, because the caller is a job that must distinguish three
 * cases with different consequences: retry later, stop retrying this endpoint forever, and "push
 * isn't set up here". A thrown error collapses all three into one (conventions/code.md §6 — this
 * converts rather than swallows; every failure path is either returned or logged).
 */
export async function sendPush(
  target: PushTarget,
  message: { title: string; body: string; url?: string },
): Promise<PushOutcome> {
  const config = vapidConfig()
  if (config === null) return { status: 'not-configured' }

  keysPromise ??= ApplicationServerKeys.fromJSON({
    publicKey: config.publicKey,
    privateKey: config.privateKey,
  })

  try {
    const request = await generatePushHTTPRequest({
      applicationServerKeys: await keysPromise,
      payload: JSON.stringify(message),
      target: { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      adminContact: config.subject,
      // 24 hours: if the device is offline longer than that, the reminder is stale anyway and the
      // next daily scan will not re-send it (`sent_at` is already set).
      ttl: 86_400,
    })

    const response = await fetch(request.endpoint, {
      method: 'POST',
      headers: request.headers,
      // `Buffer.from` over the ArrayBuffer: Node's fetch accepts a view directly, and this
      // avoids naming DOM's `BodyInit`, which is not in this package's TS lib.
      body: Buffer.from(request.body),
    })

    if (response.status === 404 || response.status === 410) {
      // The browser permanently discarded this subscription. Retrying forever would be a slow
      // leak of failing requests, every day, with nothing surfacing it.
      return { status: 'expired' }
    }

    if (!response.ok) {
      return { status: 'failed', detail: `push service returned ${response.status}` }
    }

    return { status: 'sent' }
  } catch (error) {
    // Never silent (conventions/code.md §6). The push endpoint is third-party and unreachable
    // sometimes; that is a warn, not an error, because the next scan retries.
    logger.warn({ err: error }, 'web push request failed')
    return {
      status: 'failed',
      detail: error instanceof Error ? error.message : 'unknown push failure',
    }
  }
}

/** Used only by `scripts/generate-vapid-keys.mjs`. Never called at runtime. */
export async function generateVapidKeys(): Promise<ApplicationServerKeysJSON> {
  const keys = await ApplicationServerKeys.generate()
  return keys.toJSON()
}

export function isPushConfigured(): boolean {
  return vapidConfig() !== null
}
