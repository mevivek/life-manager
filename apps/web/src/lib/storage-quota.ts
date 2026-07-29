/**
 * Storage-quota guards for queued file uploads (ADR-0024).
 *
 * ── Why this file exists at all ──
 *
 * The read cache never had to think about quota: it holds a few kilobytes of JSON. A queued document
 * photo is megabytes, and IndexedDB is **evictable** — a browser under storage pressure may discard
 * the whole origin's data without asking and without warning.
 *
 * For a pending upload that would mean losing the only copy of a photo the user has already been told
 * is saved. ADR-0024 is explicit that this is the outcome to avoid above all others: "Refusing to
 * accept a file is a bad experience; accepting one and losing it is a bug of the worst category this
 * ADR is trying to avoid."
 *
 * So both functions below fail *towards refusing*. Every branch where the answer is unknown returns
 * the pessimistic result.
 */

/**
 * Asks the browser to make this origin's storage persistent, i.e. exempt from automatic eviction.
 *
 * Returns whether it is persistent **now** — which may be false for reasons entirely outside our
 * control: Safari does not implement `persist()` at all, and Chrome grants it based on engagement
 * heuristics (installed as a PWA, bookmarked, high engagement) rather than on asking nicely.
 *
 * A `false` here is therefore not an error, and must not block capture on its own. It is one input to
 * the warning the UI shows.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator)) return false

  try {
    // `persisted()` first: `persist()` may re-prompt on some engines, and if we already have it there
    // is nothing to ask for.
    if (typeof navigator.storage.persisted === 'function') {
      if (await navigator.storage.persisted()) return true
    }
    if (typeof navigator.storage.persist === 'function') {
      return await navigator.storage.persist()
    }
    return false
  } catch {
    // A rejected permission query is not a failure worth surfacing to the user, and it is not an
    // error path we can act on — it means "no". Deliberately swallowed, and it is the ONLY place in
    // this file that swallows anything.
    return false
  }
}

export type QuotaCheck =
  | { ok: true; persistent: boolean }
  | { ok: false; reason: string; persistent: boolean }

/**
 * Whether there is room to queue `bytes`, with headroom.
 *
 * The 2× multiplier is not superstition. `estimate()` is deliberately coarse — browsers pad and round
 * it to avoid being a fingerprinting vector — and the same bytes are briefly held twice during a
 * structured clone into IndexedDB. Queueing right up to a fuzzy limit is how you get a quota error
 * halfway through a write, which is the failure this is meant to prevent.
 */
const HEADROOM_MULTIPLIER = 2

export async function canQueueBytes(bytes: number): Promise<QuotaCheck> {
  const persistent =
    'storage' in navigator && typeof navigator.storage.persisted === 'function'
      ? await navigator.storage.persisted().catch(() => false)
      : false

  if (!('storage' in navigator) || typeof navigator.storage.estimate !== 'function') {
    // No way to ask. Refuse rather than guess: this runs only when the user is offline and about to
    // hand us the only copy of a photo.
    return {
      ok: false,
      reason:
        'This browser cannot report how much storage is free, so a photo cannot be held safely until you are back online.',
      persistent,
    }
  }

  const { quota, usage } = await navigator.storage.estimate()
  if (quota === undefined || usage === undefined) {
    return {
      ok: false,
      reason:
        'This browser did not report how much storage is free, so a photo cannot be held safely until you are back online.',
      persistent,
    }
  }

  const free = quota - usage
  if (free < bytes * HEADROOM_MULTIPLIER) {
    return {
      ok: false,
      reason: `Not enough free space to hold this file until you reconnect (needs about ${formatBytes(bytes * HEADROOM_MULTIPLIER)}, ${formatBytes(free)} free).`,
      persistent,
    }
  }

  return { ok: true, persistent }
}

/** Rounded to one decimal at MB and above; a photo described as "2411724 bytes" tells nobody anything. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
