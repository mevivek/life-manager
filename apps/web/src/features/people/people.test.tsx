import type {
  Document,
  DocumentDetailResponse,
  Person,
  PersonCreate,
  PersonUpdate,
  Thing,
} from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { routeTree } from '@/routeTree.gen'
import { server } from '@/test/msw'

/**
 * People — [ADR-0034](../../../../docs/decisions/0034-people-is-a-directory.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  Every assertion here is about a SENTENCE THE SCREEN SAYS OUT LOUD being true.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * This domain is unusual in that its design is a set of promises rather than a set of fields:
 * *"renaming someone renames them everywhere they're filed"*, *"the 4 records filed under them keep
 * the name"*, *"nobody here has an account"*. Each of those is a claim the app makes in copy, and
 * each is only true because `holder` is a copied string rather than a foreign key. So the tests are
 * about the claims — that the rename **reports what it touched**, that the remove note **states the
 * number**, that a person's page shows **both collections** — rather than about the markup.
 *
 * The **real route tree** is mounted, as in `library.test.tsx`, because a good half of what is being
 * asserted is routing: `/people` and `/people/$personId` are a parent and its child, so the person
 * screen replacing the list rather than stacking under it is a real thing that can break.
 *
 * MSW intercepts at the network layer, so the real `lib/api` client and its real Zod parsing run — a
 * fixture that drifts from `packages/shared/src/people.ts` fails here rather than in production.
 */

const SPACE = '22222222-2222-4222-8222-222222222222'
const PRIYA_ID = 'cccccccc-0000-4000-8000-000000000001'
const ARUN_ID = 'cccccccc-0000-4000-8000-000000000002'
const PASSPORT_ID = 'aaaaaaa1-0000-4000-8000-000000000000'

function person(over: Partial<Person> & { id: string; name: string }): Person {
  return {
    space_id: SPACE,
    relation: null,
    document_count: 0,
    thing_count: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function document(over: Partial<Document> & { id: string; title: string }): Document {
  return {
    space_id: SPACE,
    doc_type: 'other',
    issuer: null,
    holder: null,
    relation: null,
    identifier: null,
    identifier_last4: null,
    thing_id: null,
    issued_on: null,
    expires_on: null,
    country: null,
    notes: null,
    tags: [],
    custom_attrs: {},
    file_count: 1,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function thing(over: Partial<Thing> & { id: string; name: string }): Thing {
  return {
    space_id: SPACE,
    kind: 'other',
    brand: null,
    model: null,
    serial: null,
    serial_last4: null,
    purchased_on: null,
    price: null,
    currency: null,
    warranty_ends_on: null,
    service_every_months: null,
    service_due_on: null,
    kept_at: null,
    holder: null,
    relation: null,
    ownership: 'here',
    ownership_who: null,
    ownership_since: null,
    notes: null,
    document_count: 0,
    photo_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...over,
  }
}

const PRIYA = person({
  id: PRIYA_ID,
  name: 'Priya',
  relation: 'Wife',
  document_count: 3,
  thing_count: 1,
})

/** Priya's paperwork and Priya's bicycle — the two halves a person's page has to show together. */
const PRIYA_PASSPORT = document({
  id: 'aaaaaaa2-0000-4000-8000-000000000000',
  title: 'Priya’s passport',
  holder: 'Priya',
  relation: 'Wife',
})
const PRIYA_BICYCLE = thing({
  id: 'bbbbbbb2-0000-4000-8000-000000000000',
  name: 'Bicycle',
  holder: 'Priya',
})

/** Mine, for the You row's counts and for the Whose sheet's document. */
const MY_PASSPORT: DocumentDetailResponse = {
  ...document({ id: PASSPORT_ID, title: 'Passport', version: 4 }),
  files: [],
  reminders: [],
}

/**
 * Every read the People screens and the document detail make.
 *
 * `server.use` **prepends**, so these shadow `test/msw.ts`'s defaults — and every handler has to be
 * installed before the render, because `setup.ts` sets `onUnhandledRequest: 'error'` and an unstubbed
 * call fails on the fetch rather than on anything being asserted.
 *
 * The documents and things handlers honour `?holder=`, because that filter is not incidental here: it
 * is *how* a person's page is built (there is no join — ADR-0034), so a handler that ignored it would
 * make the person-detail test pass on a screen that showed everybody's records.
 */
function stubApi({
  people = [PRIYA],
  documents = [MY_PASSPORT, PRIYA_PASSPORT],
  things = [PRIYA_BICYCLE],
}: {
  people?: Person[]
  documents?: Document[]
  things?: Thing[]
} = {}) {
  server.use(
    http.get('*/api/v1/people', () => HttpResponse.json({ data: people })),
    // Before the `:id` route below, or "holders" is parsed as a document id.
    http.get('*/api/v1/documents/holders', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/documents/issuers', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/documents', ({ request }) =>
      HttpResponse.json({ data: byHolder(documents, request.url), next_cursor: null }),
    ),
    http.get(`*/api/v1/documents/${PASSPORT_ID}`, () => HttpResponse.json(MY_PASSPORT)),
    http.get('*/api/v1/things/holders', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/things', ({ request }) =>
      HttpResponse.json({ data: byHolder(things, request.url), next_cursor: null }),
    ),
  )
}

/** `?holder=mine` means `holder IS NULL`; any other value is an exact match; absent means no filter. */
function byHolder<T extends { holder: string | null }>(rows: T[], url: string): T[] {
  const holder = new URL(url).searchParams.get('holder')
  if (holder === null) return rows
  if (holder === 'mine') return rows.filter((row) => row.holder === null)
  return rows.filter((row) => row.holder === holder)
}

async function renderAt(path: string) {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
  return { ...result, router }
}

beforeEach(() => {
  stubApi()
})

describe('the directory lists who you file for', () => {
  it('shows a person with their relation and their counts', async () => {
    await renderAt('/people')

    expect(await screen.findByRole('heading', { name: 'People' })).toBeInTheDocument()
    // Relation first, then documents, then things — and things only because there is one. The whole
    // line, not three separate `getByText`s: the order is what tells two Aruns apart.
    expect(await screen.findByText('Wife · 3 documents · 1 thing')).toBeInTheDocument()
    expect(screen.getByText('Priya')).toBeInTheDocument()
  })

  it('says out loud that nobody here has an account', async () => {
    // The most important sentence on the screen. A list of names in an app with sign-in reads as a
    // sharing feature unless it says otherwise, and this one is a filing label (invariant 2).
    await renderAt('/people')
    expect(
      await screen.findByText(/Nobody here has an account and nobody gets notified/),
    ).toBeInTheDocument()
  })

  it('puts You first, counting what has no name against it', async () => {
    await renderAt('/people')

    // `?holder=mine` is `holder IS NULL`, so this is exactly one document (`Passport`) and no things.
    // By its accessible name, not its text: "You" is also the back link and the third tab, and the
    // row's label is where design.md §9 says the meta line has to be readable anyway.
    await waitFor(() =>
      expect(screen.getAllByRole('link').map((row) => row.getAttribute('aria-label'))).toContain(
        'You — 1 document',
      ),
    )
  })
})

describe('adding someone', () => {
  it('POSTs the name and shows them in the list', async () => {
    const user = userEvent.setup()
    const posted: PersonCreate[] = []
    let directory = [PRIYA]

    stubApi()
    server.use(
      http.get('*/api/v1/people', () => HttpResponse.json({ data: directory })),
      http.post('*/api/v1/people', async ({ request }) => {
        posted.push((await request.json()) as PersonCreate)
        const created = person({ id: ARUN_ID, name: 'Arun', relation: 'Son' })
        directory = [...directory, created]
        return HttpResponse.json(created)
      }),
    )

    await renderAt('/people')
    await screen.findByText('Priya')

    await user.click(screen.getByRole('button', { name: 'Add someone' }))
    const sheet = await screen.findByRole('dialog')
    await user.type(within(sheet).getByLabelText('Name · required'), 'Arun')
    // A suggestion chip, not the free-text field: the chips are a shortcut into the same string, and
    // this is the path that would break if `RELATION_SUGGESTIONS` were ever treated as an enum.
    await user.click(within(sheet).getByRole('button', { name: 'Son' }))
    await user.click(within(sheet).getByRole('button', { name: 'Add person' }))

    await waitFor(() => expect(posted).toEqual([{ name: 'Arun', relation: 'Son' }]))
    expect(await screen.findByText('Arun')).toBeInTheDocument()
  })
})

describe('renaming reports what it touched', () => {
  it('says how many records the rename actually moved', async () => {
    /**
     * The claim: *"Renaming someone renames them everywhere they're filed."*
     *
     * The client cannot know how many rows that was — they are in two other domains and may not be
     * loaded — which is why `renamedResponseSchema` returns the counts. A toast that just said
     * "Saved" would leave the app's loudest promise unevidenced.
     */
    const user = userEvent.setup()
    const patched: PersonUpdate[] = []

    stubApi()
    server.use(
      http.patch(`*/api/v1/people/${PRIYA_ID}`, async ({ request }) => {
        patched.push((await request.json()) as PersonUpdate)
        return HttpResponse.json({
          person: { ...PRIYA, name: 'Priya Nair', version: 2 },
          documents_updated: 2,
          things_updated: 1,
        })
      }),
    )

    await renderAt('/people')
    await user.click(await screen.findByRole('button', { name: 'Edit Priya' }))

    const sheet = await screen.findByRole('dialog')
    const name = within(sheet).getByLabelText('Name · required')
    await user.clear(name)
    await user.type(name, 'Priya Nair')
    await user.click(within(sheet).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved — 2 documents and 1 thing updated')).toBeInTheDocument()
    // And the precondition went with it: the version the sheet was OPENED at, per ADR-0024.
    expect(patched).toEqual([{ version: 1, name: 'Priya Nair', relation: 'Wife' }])
  })
})

describe('the remove note states what survives', () => {
  it('names the number of records that keep the name', async () => {
    // ADR-0034 exists because a foreign key cannot make this sentence true: removing a person would
    // have to null the records, block the delete, or cascade. If this copy ever loses its number, the
    // screen has stopped explaining the one thing a user would worry about.
    const user = userEvent.setup()
    await renderAt('/people')

    await user.click(await screen.findByRole('button', { name: 'Edit Priya' }))
    const sheet = await screen.findByRole('dialog')

    // 3 documents + 1 thing, counted server-side on the person.
    expect(
      within(sheet).getByText(
        'The 4 records filed under them keep the name — they just stop being offered as a choice.',
      ),
    ).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Remove Priya' })).toBeInTheDocument()
  })
})

describe('a person’s page holds both collections', () => {
  it('shows that person’s documents AND their things in one list', async () => {
    /**
     * The reason the screen is worth having: *"where is Priya's stuff"* is a question neither the
     * document list nor the thing list can answer on its own. Both rows are the library's own — a
     * `DocumentRow` and a `ThingRow` — so this also fails if somebody writes a third row component.
     */
    await renderAt(`/people/${PRIYA_ID}`)

    expect(await screen.findByRole('heading', { name: 'Priya' })).toBeInTheDocument()
    expect(await screen.findByText('Priya’s passport')).toBeInTheDocument()
    expect(await screen.findByText('Bicycle')).toBeInTheDocument()

    // And nothing filed under anybody else: the page is `?holder=Priya` on both collections, not a
    // client-side filter over everything.
    expect(screen.queryByText('Passport')).not.toBeInTheDocument()
  })

  it('replaces the directory rather than rendering underneath it', async () => {
    // `/people/$personId` generates as a CHILD of `/people`, so the list component stays mounted. If
    // it ever draws its own body as well, this screen has two headings and two back links.
    await renderAt(`/people/${PRIYA_ID}`)
    await screen.findByRole('heading', { name: 'Priya' })

    expect(screen.queryByRole('heading', { name: 'People' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add someone' })).not.toBeInTheDocument()
  })
})

describe('the Whose sheet on a document', () => {
  it('offers Mine plus every person, and picking one PATCHes the holder', async () => {
    /**
     * The other half of the domain: a directory is only worth maintaining if it is *offered* where
     * the filing happens. `holder` is a label and nothing else — picking a name changes no
     * permission, which is why the sheet says so on its own subtitle.
     */
    const user = userEvent.setup()
    const patched: unknown[] = []

    stubApi()
    server.use(
      http.patch(`*/api/v1/documents/${PASSPORT_ID}`, async ({ request }) => {
        patched.push(await request.json())
        return HttpResponse.json({ ...MY_PASSPORT, holder: 'Priya', version: 5 })
      }),
    )

    await renderAt(`/documents/${PASSPORT_ID}`)
    await screen.findByRole('heading', { level: 1, name: 'Passport' })

    await user.click(await screen.findByRole('button', { name: 'Whose: Mine. Change it.' }))

    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByText('Whose document is this?')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Mine' })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: '+ Someone else' })).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Priya · Wife' }))

    // The relation travels with the person, and the version is the one the screen was showing when
    // the sheet was OPENED (ADR-0024, debt D41) — not one re-read at the tap.
    await waitFor(() =>
      expect(patched).toEqual([{ holder: 'Priya', relation: 'Wife', version: 4 }]),
    )
    expect(await screen.findByText('Filed under Priya')).toBeInTheDocument()
  })
})

describe('a person’s own page does not repeat their name on every row', () => {
  it('draws no holder pill, because the name is the heading', async () => {
    /*
      Found by rendering `/people/:id` at 390px: three rows each carrying a "Priya" pill, under a
      heading reading "Priya". The comp's person view draws none. Everywhere ELSE the pill stays — it
      is what distinguishes two otherwise identical documents in a mixed list — so the control case
      below asserts the suppression is scoped rather than a deletion.

      **Wait for a ROW, not for the heading.** The heading renders before the two queries resolve, so
      asserting on pills at that point finds none because there are no rows yet — the first draft of
      this test passed against its own mutation for exactly that reason.
    */
    stubApi()
    await renderAt(`/people/${PRIYA_ID}`)

    await screen.findByText('Priya’s passport')
    await screen.findByText('Bicycle')

    expect(pillsReading('Priya')).toEqual([])
  })

  it('still draws the pill in the library, where it distinguishes rows', async () => {
    // The control. Without this, deleting the pill outright would also pass the test above.
    stubApi()
    await renderAt('/library?scope=documents')

    await screen.findByText('Priya’s passport')
    expect(pillsReading('Priya')).toHaveLength(1)
  })
})

/** The holder pill specifically — a `rounded-pill` span, not the heading that shares its text. */
function pillsReading(name: string): HTMLElement[] {
  return screen
    .queryAllByText(name)
    .filter((node) => node.tagName === 'SPAN' && node.className.includes('rounded-pill'))
}
