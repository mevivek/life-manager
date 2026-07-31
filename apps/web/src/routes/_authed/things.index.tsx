import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod'

/**
 * `/things` — **a redirect into the library's Things scope.**
 * [ADR-0032](../../../../docs/decisions/0032-one-library-tab.md).
 *
 * The sibling of `documents.index.tsx`, and its comment holds the argument for why a forwarding
 * address exists at all rather than the route simply being deleted. One reason is specific to this
 * one: `ThingDetail`'s back link and its post-delete navigation both pointed at `/things`, so this
 * route was reachable from inside the app and not only from a bookmark. Those call sites now target
 * `/library` directly — this is for everything that has already been shared or saved.
 */

/**
 * The things list's old search schema, kept verbatim so an old URL is *parsed* rather than discarded.
 * `.default()` and `.catch()` on every field, for the reasons the library's own schema states.
 */
const searchSchema = z.object({
  kind: z.string().default('').catch(''),
  who: z.string().default('').catch(''),
  ownership: z.enum(['', 'here', 'lent', 'gone']).default('').catch(''),
})

export const Route = createFileRoute('/_authed/things/')({
  validateSearch: searchSchema,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: '/library',
      search: {
        ...search,
        scope: 'things',
        q: '',
        search: false,
        type: '',
        tag: '',
        before: '',
        scan: '',
      },
      replace: true,
    })
  },
})
