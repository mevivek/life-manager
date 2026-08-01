import { formatDateShort } from '@/features/documents/ExpiryStatus'

/**
 * Rendering an **instant** — a real moment, not a calendar date.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Two kinds of date live in this app, and mixing them up is the same bug in both directions.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * - A **calendar date** — `expires_on`, `purchased_on`, `serviced_on`, `due_on` — is `YYYY-MM-DD` and
 *   carries **no zone at all**. It is rendered by slicing the string (`formatDate` in
 *   `ExpiryStatus.tsx`), and it must never pass through here: converting a zoneless date is how it
 *   drifts a day, which is the bug that file's note describes.
 * - An **instant** — `created_at`, `updated_at`, `uploaded_at`, a build time — is an ISO timestamp with
 *   an offset. `conventions/api.md` §2 states the contract: *timestamps are always UTC, clients
 *   localize*. This module is where the client does that, and it is the only place.
 *
 * Reading an instant with `.slice(0, 10)` or `.toISOString()` takes the **UTC** calendar day, so a
 * scan uploaded at 18:00 on 30 July at UTC-07:00 reads back "Added 31 Jul" — the app disagreeing with
 * the user about the day they did something. Every display of an instant goes through `localDay` or
 * `localStamp` instead.
 *
 * ── Why `Intl`, when the rest of the app hand-rolls its dates ──
 *
 * `formatDate` is hand-rolled precisely because a calendar date must **not** be resolved against a
 * zone. Here the opposite is true — the zone is the whole point — and `getFullYear()` and friends can
 * only ever read the runner's own zone, which makes the behaviour untestable anywhere but the machine
 * it runs on. `Intl` takes a zone as an argument, so the conversion is injectable in exactly the way
 * `today` is injectable across this codebase.
 *
 * The **month words still come from the app's one table**, via `formatDateShort`: `Intl` is used to
 * resolve the instant into calendar parts *in a given zone*, and the app decides how those parts read.
 * A second month table is how "12 Jan 2026" and "12 January 2026" end up on the same screen.
 */

/** Test seams. Both default to the reader's own — which is the entire point in production. */
export type ZoneOptions = {
  /** An IANA zone. Defaults to the reader's. */
  timeZone?: string
  /**
   * Only used for the **zone's name**, never for the date words.
   *
   * A zone abbreviation exists only in the locales that use it: `Asia/Kolkata` is `IST` under `en-IN`
   * and `GMT+5:30` under `en-GB`, because CLDR has no English abbreviation for India outside India.
   * So the name is asked for in the reader's own locale, which is the one most likely to have it, and
   * `Intl` falls back to a GMT offset when it does not. Both are unambiguous; neither is ever wrong.
   */
  locale?: string
}

/** The calendar parts of an instant, resolved in `timeZone`. */
type Parts = { date: string; time: string }

function partsOf(iso: string | null | undefined, timeZone?: string): Parts | null {
  if (iso == null || iso === '') return null
  const at = new Date(iso)
  // `new Date('nonsense')` is an Invalid Date rather than a throw, and formats as "Invalid Date".
  if (Number.isNaN(at.getTime())) return null

  /**
   * `hourCycle: 'h23'` rather than `hour12: false`.
   *
   * The two are not synonyms: `hour12: false` resolves to `h24` in several locales, which prints
   * midnight as **24:15** instead of 00:15. A build at ten past midnight would have shown a time no
   * clock displays.
   */
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at)

  const find = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? ''

  const year = find('year')
  const month = find('month')
  const day = find('day')
  if (year === '' || month === '' || day === '') return null

  return { date: `${year}-${month}-${day}`, time: `${find('hour')}:${find('minute')}` }
}

/** The zone's own short name — `IST`, `BST`, `PDT`, or a `GMT+5:30` offset where there is none. */
function zoneName(iso: string, { timeZone, locale }: ZoneOptions): string {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(iso))
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
}

/**
 * An instant → `12 Jan 2026`, on the **reader's** calendar.
 *
 * No time and no zone name: this is for a date that is read as a date — when a record was added, when
 * a scan landed — where the hour is noise and the day is the fact. `null` for anything unreadable, so
 * a caller renders nothing rather than "NaN NaN NaN". Absence here means a response field missing from
 * a cache entry written by an older build (debt D46), which the next fetch repairs.
 */
export function localDay(iso: string | null | undefined, options: ZoneOptions = {}): string | null {
  const parts = partsOf(iso, options.timeZone)
  return parts === null ? null : formatDateShort(parts.date)
}

/**
 * An instant → `12 Jan 2026, 13:45 IST` — the day, the time, and which clock it is on.
 *
 * The zone is named because an **unlabelled local time is indistinguishable from an unlabelled UTC
 * one**, and this is used where two timestamps sit side by side and get compared (the two halves of
 * the Build card, stamped by two different machines). Converting both to the reader's zone keeps them
 * comparable — it is the same conversion applied to both — and the name is what tells the reader which
 * clock they are reading.
 */
export function localStamp(
  iso: string | null | undefined,
  options: ZoneOptions = {},
): string | null {
  const parts = partsOf(iso, options.timeZone)
  if (parts === null || iso == null) return null
  const zone = zoneName(iso, options)
  const stamp = `${formatDateShort(parts.date)}, ${parts.time}`
  return zone === '' ? stamp : `${stamp} ${zone}`
}
