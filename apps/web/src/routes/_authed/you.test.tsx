import type { Document, Thing } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { routeTree } from '@/routeTree.gen'
import { server } from '@/test/msw'

/**
 * The You screen's **What we hold** figures and **App** rows, as handoff 5 expands them.
 *
 * These are all statements of fact about the user's own records, which is exactly the class of thing
 * that can be confidently wrong: every one of them is an arithmetic result presented as a sentence.
 * So the tests are about the arithmetic's *rules* — what a total excludes, what a count rounds — and
 * not about the wording.
 *
 * The screen is mounted through the **real route tree**, so the same guard, hooks and Zod parsing run
 * as in the app. MSW intercepts at the network layer.
 */

const SPACE = '22222222-2222-4222-8222-222222222222'

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

/** A contents policy, without which the value row cannot state a currency and draws nothing. */
const POLICY = document({
  id: 'aaaaaaa9-0000-4000-8000-000000000000',
  title: 'Home contents insurance',
  doc_type: 'financial',
  tags: ['home'],
  custom_attrs: { value: '1200000.00', currency: 'INR' },
})

function stub({ documents = [POLICY], things = [] }: { documents?: Document[]; things?: Thing[] }) {
  server.use(
    http.get('*/api/v1/documents', () => HttpResponse.json({ data: documents, next_cursor: null })),
    http.get('*/api/v1/documents/holders', () => HttpResponse.json({ data: [] })),
    http.get('*/api/v1/things', () => HttpResponse.json({ data: things, next_cursor: null })),
    http.get('*/api/v1/things/holders', () => HttpResponse.json({ data: [] })),
    // No VAPID key: the reminders card removes itself, which keeps these assertions about the rows.
    http.get('*/api/v1/push/public-key', () => HttpResponse.json({ public_key: null })),
    http.get('*/api/v1/health', () =>
      HttpResponse.json({
        status: 'ok',
        version: 'abc1234',
        uptime_seconds: 300,
        built_at: '2026-07-31T00:00:00.000Z',
      }),
    ),
  )
}

async function renderYou() {
  const queryClient = createQueryClient()
  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: ['/you'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
}

/**
 * The `<dd>` beside a term — where both `Stat` and `Figure` put their answer.
 *
 * `Figure` is `flex-col-reverse`, so its DOM order is `<dt>` then `<dd>` while the *visual* order is
 * figure then label. Reading the `<dd>` rather than a sibling index is what makes this work for both.
 */
function valueFor(term: string): string {
  const dt = screen.getByText(term, { selector: 'dt' })
  return dt.parentElement?.querySelector('dd')?.textContent?.trim() ?? ''
}

/**
 * Wait for a row's value to settle.
 *
 * Every row here renders its label immediately and fills its value when two queries resolve, so
 * `findByText(label)` returns far too early — the first draft of this file asserted against the
 * pending state and "passed" by reading an em dash. Poll the value instead.
 */
async function settledValue(term: string, expected: string): Promise<void> {
  await waitFor(() => expect(valueFor(term)).toBe(expected))
}

describe('what we hold, across both domains', () => {
  it('counts things owned beside documents filed', async () => {
    stub({
      documents: [
        POLICY,
        document({ id: 'aaaaaaa1-0000-4000-8000-000000000000', title: 'Passport' }),
      ],
      things: [
        thing({ id: 'bbbbbbb1-0000-4000-8000-000000000000', name: 'Swift' }),
        thing({ id: 'bbbbbbb2-0000-4000-8000-000000000000', name: 'Geyser' }),
      ],
    })
    await renderYou()

    expect(await screen.findByText('Things owned')).toBeInTheDocument()
    expect(screen.getByText('Documents filed')).toBeInTheDocument()
  })

  it('excludes a handed-on thing from Things owned, because it is not owned', async () => {
    // A `gone` thing keeps its record deliberately (things.md §4 rule 4) and is not a possession. A
    // count captioned "owned" that included it would be false in the plainest possible way.
    stub({
      things: [
        thing({ id: 'bbbbbbb1-0000-4000-8000-000000000000', name: 'Swift' }),
        thing({
          id: 'bbbbbbb2-0000-4000-8000-000000000000',
          name: 'Old bicycle',
          ownership: 'gone',
        }),
      ],
    })
    await renderYou()

    await settledValue('Things owned', '1')
  })

  it('watches dates from BOTH domains under one figure', async () => {
    // One daily scan watches a passport expiry, a warranty end and a service date. Two figures would
    // have implied two mechanisms.
    stub({
      documents: [
        POLICY,
        document({
          id: 'aaaaaaa1-0000-4000-8000-000000000000',
          title: 'Passport',
          expires_on: '2027-09-12',
        }),
      ],
      things: [
        thing({
          id: 'bbbbbbb1-0000-4000-8000-000000000000',
          name: 'Geyser',
          warranty_ends_on: '2028-11-02',
        }),
        thing({ id: 'bbbbbbb2-0000-4000-8000-000000000000', name: 'Sofa' }),
      ],
    })
    await renderYou()

    // POLICY carries no `expires_on`, so: one dated document + one thing with a warranty = 2.
    await settledValue('Dates watched', '2')
  })
})

describe('the App rows state what you own', () => {
  it('totals only what you still own, in the policy’s currency', async () => {
    stub({
      things: [
        thing({
          id: 'bbbbbbb1-0000-4000-8000-000000000000',
          name: 'Swift',
          price: '840000.00',
          currency: 'INR',
        }),
        // Handed on: excluded from the total, exactly as the sum-insured bar excludes it.
        thing({
          id: 'bbbbbbb2-0000-4000-8000-000000000000',
          name: 'Old bicycle',
          ownership: 'gone',
          price: '20000.00',
          currency: 'INR',
        }),
      ],
    })
    await renderYou()

    await waitFor(() => expect(valueFor('Value of things')).toContain('840,000'))
    const value = valueFor('Value of things')
    // The 20,000 bicycle must not be in it. Asserted on the total rather than on its absence, because
    // "does not contain 20,000" would also pass on a blank row.
    expect(value).not.toContain('860,000')
  })

  it('draws no value row at all without a policy to measure against', async () => {
    // The currency comes from the policy, never from a guessed symbol (money.ts). With no policy
    // there is nothing to state the total in, so the row is absent rather than unitless.
    stub({
      documents: [document({ id: 'aaaaaaa1-0000-4000-8000-000000000000', title: 'Passport' })],
      things: [
        thing({
          id: 'bbbbbbb1-0000-4000-8000-000000000000',
          name: 'Swift',
          price: '840000.00',
          currency: 'INR',
        }),
      ],
    })
    await renderYou()

    // Wait for the data to actually arrive before asserting an absence, or this passes on the
    // loading state and would keep passing if the row were unconditionally drawn.
    await settledValue('Things owned', '1')
    expect(screen.queryByText('Value of things')).toBeNull()
  })

  it('separates lent out from handed on, because they are different facts', async () => {
    stub({
      things: [
        thing({
          id: 'bbbbbbb1-0000-4000-8000-000000000000',
          name: 'Gold chain',
          ownership: 'lent',
        }),
        thing({
          id: 'bbbbbbb2-0000-4000-8000-000000000000',
          name: 'Old bicycle',
          ownership: 'gone',
        }),
      ],
    })
    await renderYou()

    await settledValue('Elsewhere', '1 lent out, 1 handed on')
  })

  it('says Nothing rather than a zero when everything is with you', async () => {
    stub({ things: [thing({ id: 'bbbbbbb1-0000-4000-8000-000000000000', name: 'Swift' })] })
    await renderYou()

    await settledValue('Elsewhere', 'Nothing')
  })

  it('counts one missing scan in the singular', async () => {
    // "1 documents" shipped for one render of this screen, and only a screenshot caught it.
    stub({
      documents: [
        POLICY,
        document({
          id: 'aaaaaaa1-0000-4000-8000-000000000000',
          title: 'Marriage certificate',
          file_count: 0,
        }),
      ],
    })
    await renderYou()

    await settledValue('Missing a scan', '1 document')
  })
})
