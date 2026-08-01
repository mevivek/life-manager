import type { Document, Thing } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { describe, expect, it } from 'vitest'
import { useLedger } from '@/features/documents/useLedger'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { findContentsPolicy, SumInsuredCard } from './SumInsuredCard'
import { ThingRow } from './ThingRow'

/**
 * Web tests for Things — **what the screens show**, where `CoverStatus.test.ts` covers what the ladder
 * computes.
 *
 * These cover the two things a client can get wrong on its own: what it sends and what it shows.
 * Business rules belong to the server and are tested there — a rule asserted only here would be a rule
 * that does not exist (invariant 5, ADR-0002: Android will not have it). Which is a slightly odd thing
 * to write about a domain whose server does not exist yet, and it is the reason `things.md` §4 was
 * written as a spec rather than derived from this code.
 *
 * MSW intercepts at the network layer, so the real `lib/api` client and its real Zod parsing run — a
 * fixture that drifts from `thingSchema` fails here rather than in production.
 */

/** A fixed "today" so every relative assertion is arithmetic rather than a race with the clock. */
const TODAY = new Date('2026-07-30T12:00:00.000Z')

function iso(days: number): string {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * A whole `Thing`, so the fixtures assert against the real contract rather than a convenient subset.
 *
 * Defaults are the *sparse* case on purpose — `name` is the only field required at capture (business
 * rule 1, Q2), so a thing with no kind detail, no price, no cover and no photo is completely normal and
 * every component has to render it. A fixture full of values would hide exactly that.
 */
function thing(overrides: Partial<Thing> & { id: string; name: string }): Thing {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
    kind: 'other',
    brand: null,
    model: null,
    serial: null,
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
    // ADR-0024's precondition column. `1` is what a freshly created record carries, so the fixture
    // stays honest rather than using a round number that never occurs.
    version: 1,
    ...overrides,
  }
}

/**
 * A router with the two Things routes and the document detail, so every `<Link>` under test resolves.
 *
 * `RouterProvider` renders nothing until the router has resolved its first match, so awaiting `load()`
 * is what makes these tests synchronous afterwards rather than a pile of `waitFor`s.
 */
async function renderWithRouter(ui: React.ReactElement) {
  /**
   * The client is built **once, here** — not inside the route component.
   *
   * `createQueryClient()` in the component body runs on every render, so each render mounted a *new*
   * client, every in-flight query was abandoned with it, and `isSuccess` never arrived: the probe below
   * sat on "ledger loading" forever while MSW answered the request each time. A fresh client per test
   * (rather than per render) is what keeps tests isolated, which is the property that was wanted.
   */
  const queryClient = createQueryClient()
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  })
  const children = [
    createRoute({ getParentRoute: () => rootRoute, path: '/things', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/things/$thingId',
      component: () => null,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/documents', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/documents/$documentId',
      component: () => null,
    }),
  ]
  const router = createRouter({
    routeTree: rootRoute.addChildren(children),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

describe('a thing row', () => {
  it('draws all four cover states in words, and never says “Expired”', async () => {
    await renderWithRouter(
      <>
        <ThingRow
          today={TODAY}
          thing={thing({
            id: '1',
            name: 'MacBook Air',
            purchased_on: iso(-365),
            warranty_ends_on: iso(730),
          })}
        />
        <ThingRow
          today={TODAY}
          thing={thing({
            id: '2',
            name: 'Bosch dishwasher',
            purchased_on: iso(-365),
            warranty_ends_on: iso(42),
          })}
        />
        <ThingRow
          today={TODAY}
          thing={thing({
            id: '3',
            name: 'Volkswagen Golf',
            purchased_on: iso(-2000),
            warranty_ends_on: iso(-191),
          })}
        />
        <ThingRow today={TODAY} thing={thing({ id: '4', name: 'Gold chain' })} />
      </>,
    )

    expect(screen.getByText('2 years left')).toBeInTheDocument()
    expect(screen.getByText('Ends in 6 weeks')).toBeInTheDocument()
    // The date, not an alarm. ADR-0029: a dishwasher whose warranty ended keeps washing dishes.
    expect(screen.getByText('Ended 20 Jan 2026')).toBeInTheDocument()
    expect(screen.getByText('No warranty recorded')).toBeInTheDocument()

    // The tags carry the tone, so they are the other half of the ladder being readable.
    expect(screen.getByText('Covered')).toBeInTheDocument()
    expect(screen.getByText('Cover ends')).toBeInTheDocument()
    expect(screen.getByText('Cover ended')).toBeInTheDocument()
    expect(screen.getByText('No cover')).toBeInTheDocument()

    // Nowhere on the screen, in any casing. This is the assertion the whole ADR rests on.
    expect(document.body.textContent).not.toMatch(/expir/i)
  })

  it('names the cover state and the absolute date in the row’s accessible name', async () => {
    // Every glyph is aria-hidden, so this is the only place the state exists for a screen reader.
    await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({
          id: '1',
          name: 'Bosch dishwasher',
          purchased_on: iso(-365),
          warranty_ends_on: iso(42),
        })}
      />,
    )

    const row = screen.getByRole('link', {
      name: 'Bosch dishwasher — cover ends in 6 weeks, 10 September 2026',
    })
    // A real link, so it is tabbable and gets the global focus ring — not a div with an onClick.
    expect(row).toHaveAttribute('href', '/things/1')
  })

  it('renders no bar at all when there is no warranty, only a dotted rule', async () => {
    const { container } = await renderWithRouter(
      <ThingRow today={TODAY} thing={thing({ id: '1', name: 'Gold chain' })} />,
    )

    expect(screen.getByText('No warranty recorded')).toBeInTheDocument()
    // The `none` glyph is a border, not a filled track — so nothing carries a width percentage. A
    // proportional bar here would be a bar drawn against a span that does not exist.
    expect(container.querySelector('[style*="width: 0%"]')).toBeNull()
    expect(container.querySelector('[style*="%"]')).toBeNull()
    // And it is a dotted rule, which is the shape that distinguishes it in greyscale.
    expect(container.querySelector('.border-dotted')).not.toBeNull()
  })

  it('draws the bar at the fraction of the span remaining', async () => {
    // Bought 730 days ago with 730 left: half the span. The width is the datum, so it is the one thing
    // in this component asserted as a style rather than as text.
    const { container } = await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({
          id: '1',
          name: 'MacBook Air',
          purchased_on: iso(-730),
          warranty_ends_on: iso(730),
        })}
      />,
    )

    expect(container.querySelector('[style*="width: 50%"]')).not.toBeNull()
  })

  it('dims a thing that is gone, and still renders it', async () => {
    const { container } = await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({
          id: '1',
          name: 'Old iPhone',
          ownership: 'gone',
          ownership_who: 'Sam',
          ownership_since: '2026-03-04',
        })}
      />,
    )

    /**
     * things.md §4 rule 4: **dimmed, not hidden.** Hiding a sold thing would make the archive lie about
     * what it holds, and the record is kept because proving what you handed over and when is a large
     * part of why anyone files a receipt.
     */
    expect(screen.getByText('Old iPhone')).toBeInTheDocument()
    expect(container.querySelector('.opacity-55')).not.toBeNull()
    expect(screen.getByText('No longer yours')).toBeInTheDocument()
    /**
     * The **formatted** date. This assertion used to expect the raw `2026-03-04`, which is what the row
     * actually printed — and what the detail banner's `awayLabel` never did, so one record read two ways
     * on two screens. Both now go through `formatDateShort`; no screen shows a user an ISO date.
     */
    expect(screen.getByText('Handed to Sam · 4 Mar 2026')).toBeInTheDocument()
  })

  it('reads as a sentence when a lent thing has no “who” recorded', async () => {
    // Both ownership details are optional even when the state is not `here`, so every combination has
    // to be a sentence. The alternative this prevents is a row printing "Lent to null".
    await renderWithRouter(
      <ThingRow today={TODAY} thing={thing({ id: '1', name: 'Drill', ownership: 'lent' })} />,
    )

    expect(screen.getByText('With someone else')).toBeInTheDocument()
    expect(screen.getByText('Lent out')).toBeInTheDocument()
  })

  it('counts documents, and the count is not zero', async () => {
    /**
     * A NON-ZERO count, deliberately — design.md §10 and debt **D33**. `file_count` was 0 for the whole
     * of M1 because every test happened to expect 0; the browser found it and the suite could not. The
     * document count is this domain's equivalent, and it is the reason the domain exists at all.
     */
    await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({ id: '1', name: 'Volkswagen Golf', kind: 'vehicle', document_count: 3 })}
      />,
    )

    expect(screen.getByText('3 documents')).toBeInTheDocument()

    // And the singular is a different word, not an `s` appended.
    await renderWithRouter(
      <ThingRow today={TODAY} thing={thing({ id: '2', name: 'Boiler', document_count: 1 })} />,
    )
    expect(screen.getByText('1 document')).toBeInTheDocument()
  })

  it('badges the holder beside the name, and omits it for the owner’s own', async () => {
    await renderWithRouter(
      <ThingRow today={TODAY} thing={thing({ id: '1', name: 'Bicycle', holder: 'Priya' })} />,
    )
    expect(screen.getByText('Priya')).toBeInTheDocument()

    // `null` is "mine" and is drawn as ABSENCE — no "Me" badge anywhere (things.md §4 rule 6).
    await renderWithRouter(<ThingRow today={TODAY} thing={thing({ id: '2', name: 'Kettle' })} />)
    expect(screen.queryByText('Me')).toBeNull()
  })

  it('shows the kind and brand, but never “Thing” for an unset kind', async () => {
    await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({ id: '1', name: 'Golf', kind: 'vehicle', brand: 'Volkswagen' })}
      />,
    )
    expect(screen.getByText('Vehicle · Volkswagen')).toBeInTheDocument()

    // `KIND_LABELS.other` is "Thing" — the schema default, so it would appear on every thing whose
    // kind was never chosen and say less than nothing.
    await renderWithRouter(<ThingRow today={TODAY} thing={thing({ id: '2', name: 'Kettle' })} />)
    expect(screen.queryByText('Thing')).toBeNull()
  })

  it('shows the service line only when the service is an errand', async () => {
    await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({ id: '1', name: 'Golf', kind: 'vehicle', service_due_on: iso(-3) })}
      />,
    )
    expect(screen.getByText('Service overdue')).toBeInTheDocument()
    expect(screen.getByText('Was due 27 Jul 2026')).toBeInTheDocument()

    // Eight months out is a diary entry, not a job, and a line on every row would be noise.
    await renderWithRouter(
      <ThingRow
        today={TODAY}
        thing={thing({ id: '2', name: 'Boiler', service_due_on: iso(240) })}
      />,
    )
    expect(screen.queryByText('Service due')).toBeNull()
  })
})

/*
 * A `describe('the domain switcher')` block used to sit here, asserting `aria-current` on the current
 * domain's pill and the labelled `Domain` landmark around the pair. **ADR-0031 deleted the component**
 * — Things is a tab now — so the assertions went with it rather than being kept alive against nothing.
 * The equivalent claims for the bar are in `components/TabBar.test.tsx`.
 */

// ── Sum insured ──────────────────────────────────────────────────────────────

/** A document with only the fields the policy search reads. */
function policyDocument(overrides: Partial<Document> & { id: string; title: string }): Document {
  return {
    space_id: '22222222-2222-4222-8222-222222222222',
    doc_type: 'financial',
    issuer: null,
    holder: null,
    relation: null,
    identifier: null,
    thing_id: null,
    issued_on: null,
    expires_on: null,
    country: null,
    notes: null,
    tags: [],
    custom_attrs: {},
    file_count: 0,
    version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Makes the ledger query answer with these documents, since the card reads Documents from Things. */
function withLedger(documents: Document[]) {
  server.use(
    http.get('*/api/v1/documents', () => HttpResponse.json({ data: documents, next_cursor: null })),
  )
}

const contentsPolicy = policyDocument({
  id: 'aaaaaaa1-0000-4000-8000-000000000000',
  title: 'Home contents insurance',
  custom_attrs: { value: '20000.00', currency: 'GBP' },
})

describe('finding the contents policy', () => {
  it('needs a financial document with both a value and a currency', () => {
    // Structural first: this is the shape of "a policy with a sum insured", and it is the only shape
    // the arithmetic can use at all.
    expect(findContentsPolicy([contentsPolicy])?.document.title).toBe('Home contents insurance')

    expect(
      findContentsPolicy([
        policyDocument({ id: 'b', title: 'Contents insurance', custom_attrs: { value: '9000' } }),
      ]),
    ).toBeNull()
    expect(
      findContentsPolicy([
        policyDocument({
          id: 'c',
          title: 'Contents insurance',
          doc_type: 'legal',
          custom_attrs: { value: '9000', currency: 'GBP' },
        }),
      ]),
    ).toBeNull()
  })

  it('prefers a hinted policy over another financial document with a value', () => {
    const life = policyDocument({
      id: 'd',
      title: 'Life cover',
      custom_attrs: { value: '250000.00', currency: 'GBP' },
    })

    // The tie-break, and the reason it is not a title equality check: two structural matches is the
    // normal case for a household with more than one policy.
    expect(findContentsPolicy([life, contentsPolicy])?.document.id).toBe(contentsPolicy.id)
  })

  it('finds the hint in a tag as well as a title', () => {
    const tagged = policyDocument({
      id: 'e',
      title: 'Aviva policy 2026',
      tags: ['contents'],
      custom_attrs: { value: '15000', currency: 'GBP' },
    })
    const other = policyDocument({
      id: 'f',
      title: 'Car insurance',
      custom_attrs: { value: '600', currency: 'GBP' },
    })

    expect(findContentsPolicy([other, tagged])?.document.id).toBe('e')
  })

  it('refuses to guess between two unhinted policies', () => {
    /**
     * The safety property. A card that guessed would put a confident number about somebody's insurance
     * cover on screen, and the person reading it would act on it — so ambiguity renders nothing.
     */
    const one = policyDocument({
      id: 'g',
      title: 'Aviva',
      custom_attrs: { value: '15000', currency: 'GBP' },
    })
    const two = policyDocument({
      id: 'h',
      title: 'Direct Line',
      custom_attrs: { value: '9000', currency: 'GBP' },
    })

    expect(findContentsPolicy([one, two])).toBeNull()
    // One on its own is unambiguous, so it is used even with no hint.
    expect(findContentsPolicy([one])?.document.id).toBe('g')
  })
})

/**
 * Renders once the ledger query has resolved.
 *
 * Needed for the negative test below: `SumInsuredCard` renders `null` both *before* the documents
 * arrive and *after* they arrive with no policy in them, so asserting absence straight after render
 * would pass even if the search were broken. This gives the absence something to be measured against.
 */
function LedgerProbe() {
  const ledger = useLedger()
  return <span>{ledger.isSuccess ? 'ledger loaded' : 'ledger loading'}</span>
}

describe('the sum insured card', () => {
  it('renders nothing at all when no policy is found', async () => {
    // A real UUID, because this fixture goes over the wire and `lib/api` parses it with the actual
    // `documentSchema` — an `id` of "i" fails `uuidSchema`, the query errors instead of succeeding, and
    // the card would then be absent for the wrong reason. The unit tests above call
    // `findContentsPolicy` directly and can use short ids; anything served by MSW cannot.
    withLedger([
      policyDocument({
        id: 'aaaaaaa9-0000-4000-8000-000000000000',
        title: 'Payslip',
        doc_type: 'other',
      }),
    ])

    await renderWithRouter(
      <>
        <SumInsuredCard
          things={[thing({ id: '1', name: 'MacBook Air', price: '1400.00', currency: 'GBP' })]}
        />
        <LedgerProbe />
      </>,
    )

    // Absent rather than wrong — things.md §7. The common case is that the card is not there, and the
    // probe proves the documents had actually arrived when we looked.
    await screen.findByText('ledger loaded')
    expect(screen.queryByText('Sum insured')).toBeNull()
  })

  it('totals what is still owned and says the shortfall in money when over-cover', async () => {
    withLedger([contentsPolicy])

    await renderWithRouter(
      <SumInsuredCard
        things={[
          thing({ id: '1', name: 'Golf', price: '14200.00', currency: 'GBP' }),
          thing({ id: '2', name: 'MacBook Air', price: '1400.50', currency: 'GBP' }),
          // Lent is still yours, so it counts (things.md §4 rule 4).
          thing({ id: '3', name: 'Drill', price: '9000.00', currency: 'GBP', ownership: 'lent' }),
          // Gone is not, so it does not — and this is the row that makes the total non-trivial.
          thing({
            id: '4',
            name: 'Old iPhone',
            price: '800.00',
            currency: 'GBP',
            ownership: 'gone',
          }),
        ]}
      />,
    )

    /**
     * 14200 + 1400.50 + 9000 = 24600.50, against a 20000 policy: 4600.50 over.
     *
     * ── The card ROUNDS, and the sum does not ──
     *
     * Every figure on this card goes through `formatMoney(…, 'whole')` — the comp's `gbp()` (line 1891)
     * is `Math.round` — so 24600.50 displays as 24,601 and the shortfall as 4,601. The half-unit stays
     * in the fixture because it still proves the thing it was put there for: the total is summed in
     * **minor units as integers**, and `24601` is only reachable from `2460050`. A float sum would show
     * up as a different rounded pound, not as a hidden penny.
     *
     * Asserted as digits with permissive separators rather than a literal `£24,601`, because
     * `Intl.NumberFormat` groups and points according to the *reader's* locale, and a test that pinned
     * en-US would fail on a machine with a different `LANG` for a reason unrelated to the code. The
     * **symbol** is asserted, and that is the part that matters: it comes from the policy's stored
     * currency, where the comp hardcodes `£` because its fixtures are British and the app is not.
     */
    const card = await screen.findByRole('link', { name: /Sum insured/ })
    expect(card).toHaveAttribute('href', `/documents/${contentsPolicy.id}`)
    expect(card.textContent).toMatch(/£\s?24\D?601(?!\d)/)
    expect(card.textContent).toMatch(/£\s?20\D?000/)
    expect(card.textContent).toMatch(/£\s?4\D?601 more than the policy covers/)
    // No pence anywhere on the card — the rounding is the assertion, not a side effect of one.
    expect(card.textContent).not.toMatch(/600\D50/)
    // The excluded row is genuinely excluded: 25400.50 would be the total if `gone` counted.
    expect(card.textContent).not.toMatch(/25\D?40/)
  })

  it('says it is within cover, and names things priced in another currency rather than adding them', async () => {
    withLedger([contentsPolicy])

    await renderWithRouter(
      <SumInsuredCard
        things={[
          thing({ id: '1', name: 'MacBook Air', price: '1400.00', currency: 'GBP' }),
          // Adding ₹ to £ would produce a number wrong in a way nobody can see, and there is no rate
          // here. Skipped and counted, never folded in silently.
          thing({ id: '2', name: 'Scooter', price: '90000.00', currency: 'INR' }),
        ]}
      />,
    )

    const card = await screen.findByRole('link', { name: /Sum insured/ })
    expect(card.textContent).toMatch(/£\s?1\D?400/)
    expect(card.textContent).toContain('Within cover')
    expect(card.textContent).toContain('1 thing is priced in another currency')
  })
})
