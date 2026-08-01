import { HOLDER_MINE, type Person } from '@life-manager/shared'

/**
 * The words People puts under a name, and the one sentence You puts beside the row.
 *
 * Split out of the screens because **three surfaces say the same thing** — the directory row, the
 * person's own heading, and the remove note inside the sheet — and a count phrased "1 documents" in
 * one of them is the kind of defect only a screenshot catches (the `you.tsx` note about exactly that
 * bug shipping for one render).
 */

/**
 * The `$personId` that means *you*, and it is deliberately the API's own `?holder=` sentinel.
 *
 * `/people/mine` is the row the comp draws first — everything filed with no holder against it. Reusing
 * `HOLDER_MINE` rather than inventing a second spelling means the URL segment and the query parameter
 * the screen then sends are the **same string**, so they cannot drift; and a real person's id is a
 * uuid, so `mine` can never collide with one.
 */
export const YOU_PERSON_ID = HOLDER_MINE

/**
 * The circle's letter. `•` for you, because "Y" would read as a name beginning with Y.
 *
 * `Array.from` rather than `name[0]`: a name starting with an emoji or an astral-plane character
 * would otherwise be sliced mid-surrogate and render as a replacement glyph.
 */
export function initialOf(name: string): string {
  const [first] = Array.from(name.trim())
  return first === undefined ? '•' : first.toUpperCase()
}

/**
 * `Wife · 3 documents · 1 thing`.
 *
 * Three rules, all from the comp's own normaliser:
 *
 *  - The **relation leads**, because that is what it is for — *"it just helps you tell two Aruns
 *    apart"*. It is a display aid, so it earns the first slot and nothing else.
 *  - Documents are stated even at zero; things only when there are some. A household files paperwork
 *    for people it owns nothing on behalf of, so "0 things" would be furniture on most rows.
 *  - `approx` is the `+` that keeps a floor from being read as a total (debt D33). A count derived
 *    from a capped page is a floor, and the You row's counts are.
 *
 * A `null` count is **omitted rather than drawn as zero**: `document_count` is `nullish` on the wire
 * precisely because the web and API deploy on separate triggers (debt D54), so `null` means "this
 * server does not tell me", which is not the same fact as "none".
 */
export function personMeta({
  relation,
  documentCount,
  thingCount,
  approx = '',
}: {
  relation?: string | null
  documentCount: number | null
  thingCount: number | null
  approx?: string
}): string {
  return [
    relation === null || relation === undefined || relation === '' ? null : relation,
    documentCount === null ? null : countPhrase(documentCount, 'document', approx),
    thingCount === null || thingCount === 0 ? null : countPhrase(thingCount, 'thing', approx),
  ]
    .filter((part) => part !== null)
    .join(' · ')
}

/** `1 document` / `4 documents`. Singular at one, always — see the note above. */
export function countPhrase(count: number, noun: string, approx = ''): string {
  return `${count}${approx} ${count === 1 ? noun : `${noun}s`}`
}

/**
 * The You screen's one-line answer: *"Just you"* or *"You and Priya, Arun"*.
 *
 * Named rather than counted, which is the comp's choice and the right one at this size: a household
 * directory is three or four names, and "You and Priya" tells the reader what the screen holds while
 * "4 people" makes them open it to find out. Long lists are handled by the row truncating, not by
 * this switching to a number — a summary that changes shape at five entries is two summaries.
 */
export function peopleSummary(people: readonly Person[]): string {
  if (people.length === 0) return 'Just you'
  return `You and ${people.map((person) => person.name).join(', ')}`
}
