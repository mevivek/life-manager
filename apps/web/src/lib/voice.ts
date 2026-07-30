import type { Voice } from './feel'

/**
 * **Voice** — every sentence the app says in prose, in both registers.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why the words live here and not at the call sites
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Density and face are token swaps: CSS does them and no component knows. Voice cannot work that way —
 * it rewrites sentences — so the only two options were a ternary at every call site or one module the
 * call sites ask. A ternary per sentence would mean **the plain register is only ever seen by whoever
 * happened to be looking at that screen**, and the design ships nine sentences across five files.
 * Collecting them makes the set walkable, which is what `voice.test.ts` does: every function, both
 * registers, so a half-translated sentence is a failing test rather than a surprise.
 *
 * ── What the two registers actually are ──
 *
 * **Warm** is the app's default and its character: *"One thing needs you."* — a sentence, addressed to
 * a person, that says what to do rather than what is true. **Plain** is the same information with the
 * personality removed: *"1 item due"*. Not terser for its own sake — it is for someone who finds being
 * addressed by software wearing, which is a real preference and not a lesser one.
 *
 * The rule for adding one: **plain must never say less than warm.** It may drop a reassurance, never a
 * fact. Where warm says "Everything else is in order", plain says how many others there are — the
 * count is the fact the reassurance was standing in for.
 *
 * ── The dates are also different, and that is the point ──
 *
 * Warm writes *"Wednesday 29 July"*, because a weekday is how a person locates a day. Plain writes
 * *"29 Jul 2026"*, because a year is how a record does. Same date, and neither is a formatting
 * preference — they answer different questions.
 */

/** Everything a caller needs is derived from this, so a component takes one prop rather than three. */
export type VoiceCopy = ReturnType<typeof copyFor>

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * The words, as a function of the register.
 *
 * Returned as one object rather than exported one-by-one so a component destructures what it needs and
 * a new sentence cannot be added without appearing in the walked set.
 */
export function copyFor(voice: Voice) {
  const warm = voice === 'warm'
  return {
    /**
     * The Now screen's eyebrow date.
     *
     * `Date` is passed in rather than read here: `home.tsx` already has a "today" it uses for the
     * expiry ladder, and two functions each calling `new Date()` is how a test that pins one of them
     * ends up asserting against the other.
     */
    todayLabel: (today: Date): string =>
      warm
        ? `${WEEKDAYS[today.getDay()]} ${today.getDate()} ${monthLong(today)}`
        : `${today.getDate()} ${MONTHS[today.getMonth()]} ${today.getFullYear()}`,

    /**
     * The Now headline. Three states: nothing stored, something needs you, nothing needs you.
     *
     * The plural is spelled out in both registers rather than reaching for an `s` — "1 item due" and
     * "2 items due" are different words in plain, exactly as "One thing needs you." and "2 things need
     * you." are in warm.
     */
    nowHeadline: (attention: number, total: number): string => {
      if (total === 0) return warm ? 'Nothing in here yet.' : 'No documents'
      if (attention === 0) return warm ? 'Nothing needs you today.' : 'No action due'
      if (warm) {
        return attention === 1 ? 'One thing needs you.' : `${attention} things need you.`
      }
      return `${attention} ${attention === 1 ? 'item' : 'items'} due`
    },

    /**
     * The line under the headline.
     *
     * `nextDate` is the next expiry beyond the attention window, already formatted by the caller along
     * with its relative phrase — this module does not own the expiry ladder (`ExpiryStatus.tsx` does,
     * and there must not be a second one).
     */
    nowSub: (input: {
      attention: number
      total: number
      nextDate: string | null
      nextRelative: string | null
    }): string => {
      const { attention, total, nextDate, nextRelative } = input
      if (total === 0) {
        return warm
          ? 'One field, one tap. You can fill in the rest of your life later.'
          : 'Title is the only required field.'
      }
      if (attention > 0) {
        const others = total - attention
        return warm
          ? 'Everything else is in order.'
          : `${others} other ${others === 1 ? 'document' : 'documents'}, no action due.`
      }
      if (nextDate !== null) {
        return warm
          ? `The next date is ${nextDate}${nextRelative === null ? '' : ` — ${nextRelative} away`}.`
          : `Next expiry ${nextDate}.`
      }
      return warm ? 'No document here has an expiry date.' : 'No expiry dates recorded.'
    },

    /** The call to action on an empty ledger. */
    zeroLine: warm ? 'Name one thing. That’s the whole first step.' : 'Add a document',

    /** The sign-in and sign-up screens. */
    authHeadline: warm
      ? 'The paperwork of a life, with the dates attached.'
      : 'Documents, with their expiry dates.',
    authSub: warm
      ? 'Private, single-user. We tell you what’s expiring before it does.'
      : 'Private. Expiry reminders by notification.',

    /**
     * The all-clear card.
     *
     * The threshold is passed in as `NEEDS_YOU_DAYS`, never hardcoded — the comp says 90, but that
     * predates ADR-0025's single client threshold of 45, and a sentence naming a number beside a
     * ladder that turns at a different one would be the app disagreeing with itself out loud. Taking
     * it as an argument keeps the sentence and the glyph reading from one source. (The reminder
     * *jobs* still fire at 90/30/7, and that divergence is deliberate — CLAUDE.md's third design note.)
     */
    clearTitle: (withinDays: number): string =>
      warm
        ? `Nothing expires in the next ${withinDays} days`
        : `No expiry within ${withinDays} days`,
    clearBody: (datedCount: number): string =>
      warm
        ? 'Every document with a date is checked once a day. We’d have told you.'
        : `${datedCount} dated ${datedCount === 1 ? 'document' : 'documents'} checked daily.`,

    /**
     * The Add sheet's saved step, rendered after "It’s in Documents." / "It’s in Things."
     *
     * ── Both registers used to describe a screen that no longer exists ──
     *
     * Plain said *"Saved. Optional fields below."* and warm *"Add anything else now"*, which were true
     * of the single-page form with its "Add more now" disclosure. **`ADR-0030` replaced that with a
     * six-step wizard**, and its saved step has no fields on it at all: it draws a `<dl>` reading the
     * record back, one sentence naming the blanks, then a short list of actions that each *leave* for
     * the record's own screen. So "fields below" pointed at nothing — design.md §13's rule, in the
     * register nobody opens (§12(2) named that blind spot exactly).
     *
     * What is below is a read-back, a note about gaps, and choices. Both registers now say that, and
     * plain still says no less than warm: it keeps the fact that the values are listed and adds what
     * the actions do, where warm spends its second clause on permission to leave.
     */
    savedBody: warm
      ? 'Have a look at what went in — or close this and get on with your day.'
      : 'The values saved are listed below; the actions below fill a gap.',
  }
}

function monthLong(date: Date): string {
  // `toLocaleString` rather than a second month table: the long names are only ever used here, and a
  // hardcoded English list would be the one thing in the app that cannot be localised later.
  return date.toLocaleString('en-GB', { month: 'long' })
}
