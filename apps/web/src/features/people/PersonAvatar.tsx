import { cn } from '@/lib/utils'
import { initialOf } from './personMeta'

/**
 * The initial in a circle — the comp's 38px `pr.initial` disc.
 *
 * ── A letter, never a photograph and never a colour ──
 *
 * Two things this deliberately is not. It is not an avatar image: nobody in here has an account, so
 * there is no picture to fetch and asking for one would imply there was somebody to fetch it from
 * (ADR-0034). And it is not tinted per person — colour in this system is spent on status and nothing
 * else (design.md §0), so a palette of person-colours would be the one thing that makes an expiry
 * glyph compete for attention with a name.
 *
 * So it carries no information the row does not already say in words, which is exactly why it is
 * `aria-hidden`: a screen reader announcing "P" before "Priya" is noise.
 *
 * The 38px box is the comp's geometry for a glyph — an arbitrary value where the value *is* the
 * content, which is the case design.md §1 permits.
 */
export function PersonAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-pill',
        'border border-rule-2 bg-sunken text-body font-medium text-ink-2',
        className,
      )}
    >
      {initialOf(name)}
    </span>
  )
}
