/**
 * The app's mark: a 38px rounded square holding one short ink rule.
 *
 * A **ledger line in a box** — which is the whole product in two shapes, and the only piece of
 * ornament in the design system (ADR-0025). It is deliberately not a logotype, an icon from a set, or
 * a document glyph: this app is a register of dates, and a line in a box says that where a page icon
 * would say "file cabinet".
 *
 * `aria-hidden`, because the heading beneath it already names the app. Announcing it would add
 * "image" before a sentence that reads perfectly without one.
 */
export function AuthMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-[38px] items-center justify-center rounded-2 border-[1.5px] border-ink"
    >
      <span className="block h-[2px] w-3.5 bg-ink" />
    </span>
  )
}
