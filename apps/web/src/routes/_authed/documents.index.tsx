import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * `/documents` — **a redirect into the library's Documents scope.**
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The archive screen moved to `library.tsx`. This is the forwarding address.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The screen that was here is now one scope of one screen. Deleting this route outright would have
 * been simpler and is wrong for three reasons, in ascending order of how badly it would fail:
 *
 *  1. **The PWA is installed on a real phone**, and an installed app can hold a saved URL. A 404 on
 *     `/documents` is the first thing that user would see.
 *  2. **`?scan=no` deep links exist** — the Now screen's no-scan nudge is one, and it is the reason
 *     the archive's filters were moved into the URL in the first place. Forwarding preserves them.
 *  3. **Its search params are still meaningful**, so a redirect can carry every one of them across
 *     rather than dropping the user on an unfiltered list. That is what `validateSearch` below is
 *     still doing on a route that renders nothing.
 *
 * `throw redirect` in `beforeLoad` rather than a component that navigates in an effect: the effect
 * version renders a frame of nothing first, and a back-navigation lands on it and bounces again.
 */

/**
 * The archive's old search schema, kept verbatim so an old URL is *parsed* rather than discarded.
 *
 * `.default('')` and `.catch('')` on every field for the reasons the library's own schema states —
 * `.default` makes each optional on the way in, `.catch` makes it total on the way out, so
 * `?scan=maybe` from a hand-edited URL forwards to an unfiltered list rather than throwing a route
 * error at someone who mistyped.
 */
const searchSchema = z.object({
  q: z.string().default('').catch(''),
  type: z.string().default('').catch(''),
  tag: z.string().default('').catch(''),
  before: z.string().default('').catch(''),
  scan: z.enum(['', 'yes', 'no']).default('').catch(''),
  who: z.string().default('').catch(''),
})

export const Route = createFileRoute('/_authed/documents/')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/library',
      search: {
        ...search,
        scope: 'documents',
        // A query arriving in the URL unfolds the field that owns it — otherwise the list is
        // narrowed by something with no visible cause. See the library schema's note on `search`.
        search: search.q.trim() !== '',
        kind: '',
        ownership: '',
      },
      replace: true,
    })
  },
})
