import type { Thing } from '@life-manager/shared'
import { formatDate } from '@/features/documents/ExpiryStatus'
import { cn } from '@/lib/utils'
import { formatMoney } from './money'

/**
 * Bought · Paid · Kept — the facts row list. things.md §7, comp lines 760–766.
 *
 * The same `<dl>` idiom as `documents.$documentId.tsx`'s Details section, and unset values are drawn the
 * same way: **italic, muted "Not set"** rather than the comp's `—` and rather than hiding the row.
 * Business rule 1 makes a thing with nothing but a name completely normal, so a row that vanished when
 * empty would make a sparse record look like a record that failed to load — and a dash says less than
 * the words do about *why* it is empty.
 *
 * `kept_at` is a memory aid, not an address (things.md §3): "Driveway", "Kitchen cupboard". It is here
 * because "where is the thing" is one of the four questions the domain exists to answer, and it is the
 * one the app is otherwise silent about.
 */
export function ThingFacts({
  thing,
}: {
  thing: Pick<Thing, 'purchased_on' | 'price' | 'currency' | 'kept_at' | 'notes'>
}) {
  const facts: { label: string; value: string | null; mono?: boolean; selectable?: boolean }[] = [
    {
      label: 'Bought',
      value: thing.purchased_on === null ? null : formatDate(thing.purchased_on),
    },
    {
      /**
       * "Paid", not "Value" or "Worth". things.md §2 puts what a thing is worth *today* out of scope
       * entirely — depreciation and resale are Money's business — and `price` is here because **what
       * was paid is the number an insurer asks for**. Naming it anything else would invite the wrong
       * value into the field.
       *
       * Formatted from the amount **and** its currency, never with a hardcoded symbol. See `money.ts`.
       */
      label: 'Paid',
      value: formatMoney(thing.price, thing.currency),
      mono: true,
    },
    { label: 'Kept', value: emptyToNull(thing.kept_at) },
    /**
     * Notes, last.
     *
     * Absent from the comp's `facts` array, and included anyway: the column exists on the record and
     * capture can write it (ADR-0030's thing track), so a screen that never displays it would be a
     * screen quietly withholding something the user typed. `selectable` because a note is prose
     * somebody may want to copy — the app-shell rules in `styles.css` make text unselectable by
     * default and content opts back in.
     */
    { label: 'Notes', value: emptyToNull(thing.notes), selectable: true },
  ]

  return (
    <dl className="mt-5 list-none">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="flex min-h-12 items-baseline gap-3.5 border-b border-rule py-3"
        >
          <dt className="w-24 shrink-0 text-body text-ink-3">{fact.label}</dt>
          <dd
            className={cn(
              'flex-1 [text-wrap:pretty]',
              fact.value === null
                ? 'text-body italic text-ink-3'
                : cn('text-row', fact.mono === true && 'font-mono text-body'),
              fact.selectable === true && 'selectable',
            )}
          >
            {fact.value ?? 'Not set'}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * `''` and `null` mean the same thing to a reader, so they are collapsed before rendering.
 *
 * `== null` rather than `=== null`, so a field missing entirely from a cache entry written by an older
 * build is treated as absent instead of throwing on `.trim()` — debt D46.
 */
function emptyToNull(value: string | null | undefined): string | null {
  return value == null || value.trim() === '' ? null : value
}
