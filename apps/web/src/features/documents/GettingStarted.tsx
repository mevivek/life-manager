import { Eyebrow } from '@/components/ui/label'

/**
 * What the Now screen shows a nearly-empty archive instead of blank space.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Why this exists
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The Now screen is built to answer "what needs me?" from a full archive. With two documents in it,
 * every section that would fill the screen renders nothing — the horizon is empty, the notifications
 * card is absent until VAPID is configured — and the result was a screen with a headline at the top,
 * a summary line at the foot, and a third of a phone of nothing between them. Reported from a real
 * phone, twice.
 *
 * The answer is not to stretch the layout; it is to put something true in the space. At two documents
 * the most useful thing the app can say is *which* documents to add next, because the ones with dates
 * are the only ones it can do anything with — a scan of a birth certificate is storage, whereas a
 * passport's expiry is the whole product.
 *
 * ── No control of its own ──
 *
 * `design.md` §6 says an empty state gets a sentence, one instruction and one control. The control
 * here is the **Add tab**, which is permanently on screen two inches below this text (§8: three tabs,
 * forever). A second Add button would compete with the primary one for the same action, and the
 * loser would be whichever the eye reached first. So this points at the control instead of
 * duplicating it — which is also why it takes no props for navigation and needs no router to render
 * or to test.
 */
export function GettingStarted({ count }: { count: number }) {
  return (
    <section className="pt-4">
      <div className="pb-2.5">
        <Eyebrow>Getting started</Eyebrow>
      </div>
      <p className="font-heading text-title font-face-h leading-snug [text-wrap:pretty]">
        {/*
          The serif, because this is the app talking to a person rather than labelling a field — and
          the count is stated rather than hidden, so the sentence is honest about how early it is.
        */}
        {count === 1 ? 'One document in your ledger.' : `${count} documents in your ledger.`}
      </p>
      <p className="mt-1.5 text-body leading-relaxed text-ink-2 [text-wrap:pretty]">
        Add the ones that expire first — passport, licence, insurance, warranties. Those are the
        ones this can watch for you. Anything without a date is still worth keeping, just quieter.
      </p>
      <p className="mt-2.5 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        Use <span className="font-medium text-ink-2">Add</span> below. A title on its own is enough
        — you can put the date and the scan on later.
      </p>
    </section>
  )
}
