import type {
  LinkedDocument,
  ThingDetailResponse,
  ThingPhoto,
  ThingService,
} from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { ClaimPack, packPieces } from './ClaimPack'
import { formatMoney } from './money'
import { awayLabel } from './OwnershipPanel'
import { matchSlots, PAPER_SLOT_LABELS, PapersChecklist } from './PapersChecklist'
import { cycleLabel, ServiceHistory } from './ServiceHistory'
import { ageOf, coverSpan, ThingCoverCard } from './ThingCoverCard'
import { ThingDetail } from './ThingDetail'
import { ThingSerial } from './ThingSerial'

/**
 * The **Thing detail screen** — one file per screen, alongside `things.test.tsx` (the list and the row)
 * and `CoverStatus.test.ts` (what the ladder computes).
 *
 * These cover the two things a client can get wrong on its own: **what it sends** and **what it shows**.
 * Business rules belong to the server and are tested there — a rule asserted only here would be a rule
 * that does not exist (invariant 5, ADR-0002: Android will not have it).
 *
 * MSW intercepts at the **network layer**, so the real `lib/api` client and its real Zod parsing run: a
 * fixture that drifts from `thingDetailResponseSchema` fails here rather than in production. That is also
 * why the fixtures below are whole responses rather than convenient subsets.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The default fixture is the SPARSE one. design.md §10 insists on it, and every fixture misses it.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `name` is the only field required at capture (business rule 1, Q2), so a thing with no kind detail, no
 * cover, no price, no serial, no photo and no documents is completely normal — and it is the state a
 * twelve-record fixture hides. Every value below is `null` or empty unless a test asks for it.
 */

/** A fixed "today" so every relative assertion is arithmetic rather than a race with the clock. */
const TODAY = new Date('2026-07-30T12:00:00.000Z')

/** `days` from `TODAY`, as the `YYYY-MM-DD` the API returns. */
function iso(days: number): string {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const THING_ID = '33333333-3333-4333-8333-333333333333'

/**
 * A distinct, **valid** UUID per fixture row.
 *
 * Not cosmetic: `linkedDocumentSchema.id`, `thingServiceSchema.id` and `thingPhotoSchema.id` are all
 * `uuidSchema`, and these fixtures go over MSW and through the **real** Zod parse in `lib/api`. A
 * readable `'d-1'` therefore fails the parse, the query errors, and the screen renders `NotHere` —
 * which is a passing-looking test file asserting nothing about the screen it names. Found exactly that
 * way while writing this file.
 */
function uuid(seed: string): string {
  return `${seed.padStart(8, '0')}-0000-4000-8000-000000000000`
}

function detail(overrides: Partial<ThingDetailResponse> = {}): ThingDetailResponse {
  return {
    id: THING_ID,
    space_id: '22222222-2222-4222-8222-222222222222',
    name: 'Boiler',
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
    // `1` is what a freshly created record carries, so the fixture stays honest rather than using a
    // round number that never occurs. It is also the value the write assertions below expect back.
    version: 1,
    photos: [],
    services: [],
    documents: [],
    reminders: [],
    ...overrides,
  }
}

function service(
  overrides: Partial<ThingService> & { id: string; serviced_on: string },
): ThingService {
  return {
    thing_id: THING_ID,
    cost: null,
    currency: null,
    provider: null,
    notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function linked(
  overrides: Partial<LinkedDocument> & { id: string; title: string },
): LinkedDocument {
  return { doc_type: 'other', issuer: null, expires_on: null, ...overrides }
}

function photo(overrides: Partial<ThingPhoto> & { id: string }): ThingPhoto {
  return {
    thing_id: THING_ID,
    mime: 'image/jpeg',
    size_bytes: 1_200_000,
    sha256: null,
    is_hero: false,
    uploaded_at: '2026-02-01T00:00:00.000Z',
    created_at: '2026-02-01T00:00:00.000Z',
    ...overrides,
  }
}

/**
 * ── The Things handlers ──
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A SEPARATE BLOCK, and it expects a merge. `test/msw.ts` is another agent's file.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Registered per-test with `server.use()` rather than added to the shared `handlers` array, which is the
 * right shape for these anyway: every test wants a *different* record, and a default thing in the global
 * list would be a fixture the sparse tests then had to override.
 *
 * The paths are `things.md` §5's, and the API implementing them does not exist yet (§10) — MSW stands in
 * for a server that is another session's work. When it lands, these shapes are what it has to answer,
 * because they are `packages/shared/src/things.ts` parsed for real.
 */
function serveThing(thing: ThingDetailResponse) {
  server.use(http.get(`*/api/v1/things/${thing.id}`, () => HttpResponse.json(thing)))
}

/**
 * A fresh Query client per test, so one test's cached query or mutation state cannot reach the next.
 *
 * Built **once per test** rather than inside a component body: `createQueryClient()` in a render path
 * mounts a *new* client on every render, every in-flight query is abandoned with it, and `isSuccess`
 * never arrives — a mistake already made and documented in `things.test.tsx`.
 */
let queryClient = createQueryClient()
beforeEach(() => {
  queryClient = createQueryClient()
})

/** A router with the routes every `<Link>` under test points at. */
async function renderScreen(ui: React.ReactElement) {
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  })
  const children = [
    createRoute({ getParentRoute: () => rootRoute, path: '/things', component: () => null }),
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
  // `RouterProvider` renders nothing until the router has resolved its first match, so awaiting `load()`
  // is what makes the assertions afterwards direct rather than a pile of `waitFor`s.
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

/** The whole screen, with capture stubbed — the route passes `openAddAgainst` in for real. */
async function renderDetail(thing: ThingDetailResponse, onFileAgainst = vi.fn()) {
  serveThing(thing)
  const result = await renderScreen(
    <ThingDetail thingId={thing.id} onFileAgainst={onFileAgainst} today={TODAY} />,
  )
  await screen.findByRole('heading', { level: 1 })
  return { ...result, onFileAgainst }
}

/**
 * `ServiceHistory` in a Query provider and nothing else.
 *
 * It owns a mutation, so it needs a client; it renders no `<Link>`, so it needs no router. Keeping it
 * router-free is a property worth having — it is what makes these assertions direct.
 */
function renderServiceHistory(thing: ThingDetailResponse) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ServiceHistory thingId={thing.id} thing={thing} services={thing.services} today={TODAY} />
    </QueryClientProvider>,
  )
}

// ── The cover card ───────────────────────────────────────────────────────────

describe('the cover card', () => {
  it('draws all four cover states in words, and never says “Expired”', () => {
    /**
     * The four states on the *card*, where `CoverStatus.test.ts` covers the bucket function. Both are
     * needed: the ladder can be right while the card renders one branch and a blank.
     *
     * "Expired" is asserted absent in every state, because that single word is what ADR-0029 exists to
     * keep off this screen — a dishwasher whose warranty ended keeps washing dishes.
     */
    const cases: [ThingDetailResponse, string][] = [
      [detail({ warranty_ends_on: iso(900), purchased_on: iso(-200) }), '2 years left'],
      [detail({ warranty_ends_on: iso(42), purchased_on: iso(-700) }), 'Ends in 6 weeks'],
      [detail({ warranty_ends_on: iso(-30), purchased_on: iso(-800) }), 'Ended 30 Jun 2026'],
      [detail(), 'No warranty recorded'],
    ]

    for (const [thing, words] of cases) {
      const { unmount } = render(<ThingCoverCard thing={thing} today={TODAY} />)
      expect(screen.getByText(words)).toBeInTheDocument()
      expect(screen.queryByText(/expired/i)).toBeNull()
      unmount()
    }
  })

  it('shows the four cover TAGS, which is what carries the tone', () => {
    // The tag is the one place colour is spent on this card, so each state must actually produce one.
    const cases: [ThingDetailResponse, string][] = [
      [detail({ warranty_ends_on: iso(900) }), 'Covered'],
      [detail({ warranty_ends_on: iso(42) }), 'Cover ends'],
      [detail({ warranty_ends_on: iso(-30) }), 'Cover ended'],
      [detail(), 'No cover'],
    ]

    for (const [thing, tag] of cases) {
      const { unmount } = render(<ThingCoverCard thing={thing} today={TODAY} />)
      expect(screen.getByText(tag)).toBeInTheDocument()
      unmount()
    }
  })

  it('draws the service tag only when there is a service date', () => {
    // The hairline divider is this card's decision, so the presence of the rule and the presence of the
    // date have to move together — a rule with nothing under it is the visible failure.
    const { unmount } = render(<ThingCoverCard thing={detail()} today={TODAY} />)
    expect(screen.queryByText(/service/i)).toBeNull()
    unmount()

    render(<ThingCoverCard thing={detail({ service_due_on: iso(20) })} today={TODAY} />)
    expect(screen.getByText('Service due')).toBeInTheDocument()
    expect(screen.getByText('in 3 weeks')).toBeInTheDocument()
  })

  it('renders for a thing with NO dates at all, which is the sparse case', () => {
    // Business rule 1. Every other assertion in this file would still pass if this branch threw.
    render(<ThingCoverCard thing={detail()} today={TODAY} />)
    expect(screen.getByText('No cover')).toBeInTheDocument()
    expect(screen.getByText('No warranty recorded')).toBeInTheDocument()
  })
})

describe('the cover span', () => {
  it('draws whichever of the two dates the record has, and nothing when it has neither', () => {
    expect(coverSpan('2024-03-12', '2027-03-12')).toBe('12 Mar 2024 → 12 Mar 2027')
    // The comp prints "Bought " followed by nothing for a thing with cover and no purchase date.
    expect(coverSpan(null, '2027-03-12')).toBe('Cover to 12 Mar 2027')
    expect(coverSpan('2024-03-12', null)).toBe('Bought 12 Mar 2024')
    expect(coverSpan(null, null)).toBeNull()
  })
})

describe('the age', () => {
  it('says the age the way a person does', () => {
    expect(ageOf(iso(-400), TODAY)).toBe('1y 1m old')
    expect(ageOf(iso(-60), TODAY)).toBe('2 months old')
    expect(ageOf(iso(-31), TODAY)).toBe('1 month old')
    expect(ageOf(iso(-730), TODAY)).toBe('2 years old')
  })

  it('carries a rounded twelve months into a year, where the comp prints “1y 12m old”', () => {
    // 725 days: `round((725 − 365) / 30.4)` is 12. Unguarded, that is the comp's own output.
    expect(ageOf(iso(-725), TODAY)).toBe('2 years old')
    for (let days = 1; days < 4000; days += 1) {
      expect(ageOf(iso(-days), TODAY)).not.toMatch(/12m old/)
    }
  })

  it('says something rather than “0 months old” for something bought this month', () => {
    expect(ageOf(iso(-3), TODAY)).toBe('Less than a month old')
    expect(ageOf(iso(0), TODAY)).toBe('Less than a month old')
  })

  it('says nothing at all for no purchase date, or one in the future', () => {
    expect(ageOf(null, TODAY)).toBeNull()
    // A mistyped year is the obvious way to get one, and "-1 months old" is worse than silence.
    expect(ageOf(iso(30), TODAY)).toBeNull()
  })
})

// ── Service history ──────────────────────────────────────────────────────────

describe('the service cycle', () => {
  it('states the cycle AND the next date, because a service is a cycle not a date', () => {
    // things.md §4 rule 3, and the header is where that rule is visible.
    expect(cycleLabel({ service_every_months: 12, service_due_on: '2026-08-20' })).toBe(
      'Every 12 months · Next 20 Aug 2026',
    )
    expect(cycleLabel({ service_every_months: 1, service_due_on: '2026-08-20' })).toBe(
      'Every month · Next 20 Aug 2026',
    )
    // Either half can be missing, and the comp's template prints "Every null months" for the first.
    expect(cycleLabel({ service_every_months: 12, service_due_on: null })).toBe(
      'Every 12 months · No date set',
    )
    expect(cycleLabel({ service_every_months: null, service_due_on: '2026-08-20' })).toBe(
      'Next 20 Aug 2026',
    )
  })

  it('names what the log is FOR when it is empty, rather than showing a blank section', () => {
    renderServiceHistory(detail({ service_every_months: 12, service_due_on: iso(21) }))
    expect(
      screen.getByText(/nothing logged yet\. the log is what a buyer asks to see\./i),
    ).toBeInTheDocument()
    // The control is still there — an empty log is the state you most want to log from.
    expect(screen.getByRole('button', { name: 'Serviced today — log it' })).toBeInTheDocument()
  })

  it('lists the log newest first, with the provider and a formatted cost', () => {
    const { container } = renderServiceHistory(
      detail({
        service_every_months: 12,
        service_due_on: iso(200),
        services: [
          service({
            id: uuid('1'),
            serviced_on: '2024-08-01',
            provider: 'Plumbcraft',
            cost: '95.00',
            currency: 'GBP',
          }),
          service({
            id: uuid('2'),
            serviced_on: '2026-07-01',
            provider: 'VW Kilburn',
            cost: '18500',
            currency: 'INR',
          }),
        ],
      }),
    )

    // A NON-ZERO count, asserted (design.md §10, debt D33): `file_count` read 0 for the whole of M1
    // because every test happened to expect 0.
    const rows = container.querySelectorAll('li')
    expect(rows).toHaveLength(2)

    // Newest first, even though the fixture arrives oldest-first — the log reads as history.
    expect(rows[0]?.textContent).toContain('1 July 2026')
    expect(rows[1]?.textContent).toContain('1 August 2024')

    // Two currencies, neither of them hardcoded. The comp writes `"£" + …` in its `gbp()` helper.
    expect(screen.getByText(/£95/)).toBeInTheDocument()
    expect(screen.getByText(/18[,.\s]?500/)).toBeInTheDocument()
    expect(screen.getByText('VW Kilburn')).toBeInTheDocument()
  })

  it('shows a dash rather than nothing for a service with no cost recorded', () => {
    renderServiceHistory(
      detail({
        service_every_months: 12,
        services: [service({ id: uuid('1'), serviced_on: '2026-01-05' })],
      }),
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('renders nothing when the thing has neither a cycle nor a log', () => {
    // The sparse case: nine kinds out of ten have no service cycle at all.
    const { container } = renderServiceHistory(detail())
    expect(container).toBeEmptyDOMElement()
  })

  it('still shows a log on a thing whose cycle was never set, where the comp hides it', () => {
    // The comp gates the whole section on `hasCycle`, which silently loses the rows.
    renderServiceHistory(
      detail({
        service_every_months: null,
        services: [service({ id: uuid('1'), serviced_on: '2026-01-05', provider: 'Plumbcraft' })],
      }),
    )
    expect(screen.getByText('Plumbcraft')).toBeInTheDocument()
    expect(screen.getByText('No date set')).toBeInTheDocument()
  })

  it('logs TODAY as a local calendar date, and lets the server move the next date', async () => {
    const posted: unknown[] = []
    server.use(
      http.post(`*/api/v1/things/${THING_ID}/services`, async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json(service({ id: uuid('9'), serviced_on: '2026-07-30' }))
      }),
    )

    renderServiceHistory(detail({ service_every_months: 12, service_due_on: iso(21) }))
    await userEvent.click(screen.getByRole('button', { name: 'Serviced today — log it' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    // Only `serviced_on`. **No `service_due_on`**: the server recomputes it from this date plus the
    // interval (rule 3), and a client-computed next date is one two devices can disagree about.
    expect(posted[0]).toEqual({ serviced_on: '2026-07-30' })
  })

  it('surfaces a failure rather than swallowing it', async () => {
    server.use(
      http.post(`*/api/v1/things/${THING_ID}/services`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404, detail: 'No such route.' },
          { status: 404 },
        ),
      ),
    )

    renderServiceHistory(detail({ service_every_months: 12 }))
    await userEvent.click(screen.getByRole('button', { name: 'Serviced today — log it' }))

    // Today this is literally what happens against the deployed API (things.md §10), so the honest
    // rendering of it is not a hypothetical.
    expect(await screen.findByRole('alert')).toHaveTextContent('No such route.')
  })
})

// ── The serial ───────────────────────────────────────────────────────────────

describe('the serial', () => {
  it('masks by default and reveals on request', async () => {
    render(<ThingSerial serial="356938035643809" last4="3809" kind="phone" />)

    // Masked first. The full value is already in the props — the mask is a display state, not a
    // boundary — but it must not be the thing on screen.
    expect(screen.getByText('•••• 3809')).toBeInTheDocument()
    expect(screen.queryByText('356938035643809')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Show IMEI' }))
    expect(screen.getByText('356938035643809')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hide IMEI' }))
    expect(screen.getByText('•••• 3809')).toBeInTheDocument()
  })

  it('always shows the label the KIND calls it, never a bare string', () => {
    // things.md §4 rule 8: an unlabelled twelve-character string is a string nobody can identify.
    const cases = [
      ['phone', 'IMEI'],
      ['vehicle', 'Registration'],
      ['valuable', 'Hallmark'],
      ['furniture', 'Order number'],
      ['other', 'Serial number'],
    ] as const

    for (const [kind, label] of cases) {
      const { unmount } = render(<ThingSerial serial="KA01AB1234" last4="1234" kind={kind} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })

  it('offers Copy and Show, both named after the field', () => {
    render(<ThingSerial serial="KA01AB1234" last4="1234" kind="vehicle" />)
    // Two controls, and the names distinguish them from any other masked value on a screen.
    expect(screen.getByRole('button', { name: 'Copy Registration' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Registration' })).toBeInTheDocument()
  })

  it('does not group the value, because a registration’s spacing is part of it', async () => {
    // `IdentifierCard` groups an all-digit Aadhaar number in fours. A registration and an IMEI must not
    // be reshaped — rule 9's two live plate formats are the reason.
    render(<ThingSerial serial="22BH1234AA" last4="34AA" kind="vehicle" />)
    await userEvent.click(screen.getByRole('button', { name: 'Show Registration' }))
    expect(screen.getByText('22BH1234AA')).toBeInTheDocument()
  })

  it('never claims the value is encrypted, because it is not', () => {
    // Invariant 7 and ADR-0009 keep application-level encryption for the vault; the serial is plaintext
    // by explicit decision (debt D44). The comp's document card said "encrypted at rest".
    render(<ThingSerial serial="356938035643809" last4="3809" kind="phone" />)
    expect(screen.queryByText(/encrypt/i)).toBeNull()
    expect(screen.getByText(/stored in full/i)).toBeInTheDocument()
  })

  it('renders nothing at all when the thing has no serial', () => {
    // The sparse case, and an empty bordered box under the facts reads as a field that failed to load.
    const { container } = render(<ThingSerial serial={null} last4={null} kind="laptop" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('survives a record cached by an older build, where the fields are absent entirely', () => {
    /**
     * Debt D46. The persisted cache holds `'things'` and TanStack Query **rehydrates without re-running
     * Zod**, so the first render after a deploy can be handed an object the schema says cannot exist.
     * The identical shape crashed `IdentifierCard` at the root error boundary on a real phone.
     */
    const { container, unmount } = render(
      <ThingSerial serial={undefined} last4={undefined} kind="laptop" />,
    )
    expect(container).toBeEmptyDOMElement()
    unmount()

    // And with a value but no mask: falls back to the last four of the value rather than "•••• ".
    render(<ThingSerial serial="356938035643809" last4={undefined} kind="phone" />)
    expect(screen.getByText('•••• 3809')).toBeInTheDocument()
  })
})

// ── The vehicle 2×2 ──────────────────────────────────────────────────────────

describe('“Papers this one needs”', () => {
  const registration = linked({ id: uuid('21'), title: 'Registration (V5C)', doc_type: 'identity' })
  const insurance = linked({
    id: uuid('22'),
    title: 'Vehicle insurance',
    doc_type: 'financial',
    expires_on: iso(21),
  })

  it('draws four slots, filling the ones a document matches and dashing the rest', async () => {
    await renderScreen(
      <PapersChecklist
        thing={{ kind: 'vehicle', name: 'Golf' }}
        documents={[registration, insurance]}
        onCapture={vi.fn()}
        today={TODAY}
      />,
    )

    // Four, asserted non-zero and exact — the grid's whole shape is the claim.
    expect(PAPER_SLOT_LABELS).toHaveLength(4)
    for (const label of PAPER_SLOT_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    // The two filled slots are links to the documents themselves.
    expect(screen.getAllByRole('link')).toHaveLength(2)
    // The filled insurance slot carries the DOCUMENT's own expiry status, from the one expiry ladder.
    expect(screen.getByText('in 3 weeks')).toBeInTheDocument()
    // The two unfilled ones say so, and are buttons rather than links.
    expect(screen.getAllByText('Not filed')).toHaveLength(2)
    expect(
      screen.getByRole('button', { name: 'File the roadworthiness for Golf' }),
    ).toBeInTheDocument()
  })

  it('opens capture from an EMPTY slot, with the slot resolved', async () => {
    const onCapture = vi.fn()
    await renderScreen(
      <PapersChecklist
        thing={{ kind: 'vehicle', name: 'Golf' }}
        documents={[]}
        onCapture={onCapture}
        today={TODAY}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'File the insurance for Golf' }))

    // The type and the suggested title reach the caller, which is what ADR-0030's five-step variant
    // needs. Whether the sheet uses them yet is the route file's TODO, not this component's.
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onCapture.mock.calls[0]?.[0]).toMatchObject({
      label: 'Insurance',
      preset: 'Vehicle insurance',
      docType: 'financial',
      suggestedTitle: 'Insurance — Golf',
    })
  })

  it('is ABSENT for every kind that is not a vehicle', () => {
    // things.md §9(3): a laptop's "papers it needs" is a receipt, and a checklist of one is a nag.
    for (const kind of ['laptop', 'appliance', 'valuable', 'other'] as const) {
      const { container, unmount } = render(
        <PapersChecklist
          thing={{ kind, name: 'Thing' }}
          documents={[registration]}
          onCapture={vi.fn()}
        />,
      )
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })

  it('gives one document to at most one slot', () => {
    // "Service policy schedule" matches both the insurance and the service regexes. A document in two
    // tiles would make the grid claim four papers where three exist.
    const overlapping = linked({ id: uuid('29'), title: 'Service policy schedule' })
    const matched = matchSlots([overlapping])
    expect([...matched.values()]).toHaveLength(1)
    expect(matched.get('Insurance')).toBe(overlapping)
  })

  it('matches the words a person actually writes on a title', () => {
    const matched = matchSlots([
      linked({ id: uuid('31'), title: 'V5C logbook' }),
      linked({ id: uuid('32'), title: 'Aviva policy 2026' }),
      linked({ id: uuid('33'), title: 'MOT certificate' }),
      linked({ id: uuid('34'), title: 'Full service history' }),
    ])
    expect(matched.size).toBe(4)
    expect(matched.get('Registration')?.id).toBe(uuid('31'))
    expect(matched.get('Insurance')?.id).toBe(uuid('32'))
    expect(matched.get('Roadworthiness')?.id).toBe(uuid('33'))
    expect(matched.get('Service record')?.id).toBe(uuid('34'))
  })
})

// ── The claim pack ───────────────────────────────────────────────────────────

describe('the claim pack', () => {
  /** Two pieces in, four missing — the state a real record is actually in. */
  const partial = detail({
    serial: '356938035643809',
    serial_last4: '3809',
    purchased_on: iso(-400),
    documents: [linked({ id: uuid('21'), title: 'Boiler manual', doc_type: 'other' })],
  })

  it('marks each of the six pieces In or Missing, and blocks on none of them', async () => {
    render(<ClaimPack thing={partial} />)

    // The count is in the collapsed control's name, non-zero on both sides — a "0 of 6" fixture would
    // prove nothing about the arithmetic (design.md §10, debt D33).
    await userEvent.click(screen.getByRole('button', { name: 'Claim pack — 2 of 6 pieces' }))

    expect(screen.getAllByText('In')).toHaveLength(2)
    expect(screen.getAllByText('Missing')).toHaveLength(4)
    // Six rows, always. Rule 12: missing pieces are NAMED, never hidden and never blocking.
    expect(screen.getByText('Price paid')).toBeInTheDocument()
    expect(screen.getByText('Cover end date')).toBeInTheDocument()
  })

  it('computes the six marks from the record and nothing else', () => {
    const pieces = packPieces(partial)
    expect(pieces).toHaveLength(6)
    expect(pieces.filter((piece) => piece.present)).toHaveLength(2)

    const complete = packPieces(
      detail({
        serial: 'X',
        purchased_on: iso(-10),
        price: '45999.00',
        currency: 'INR',
        warranty_ends_on: iso(400),
        photos: [photo({ id: uuid('11') })],
        documents: [linked({ id: uuid('21'), title: 'Currys receipt', doc_type: 'receipt' })],
      }),
    )
    expect(complete.every((piece) => piece.present)).toBe(true)
  })

  it('does not count a photo whose upload never finished', () => {
    // A `thing_photos` row with `uploaded_at === null` is a presign that died on the stairs. Counting it
    // would tell the user they have a photo of the boiler when they do not.
    const pieces = packPieces(detail({ photos: [photo({ id: uuid('11'), uploaded_at: null })] }))
    expect(pieces.find((piece) => piece.label === 'Photo of it')?.present).toBe(false)
  })

  it('ships NO “Build the pack” button, because there is nothing to build with', async () => {
    /**
     * The `ui/toast.tsx` judgement, asserted. The comp draws a "Build the pack" button wired to a toast
     * saying the pack is "ready"; there is no endpoint that assembles one, and no route to a thing's
     * photo bytes either — so the control would be a lie. If someone adds it back without an endpoint,
     * this fails rather than shipping the lie.
     */
    render(<ClaimPack thing={partial} />)
    await userEvent.click(screen.getByRole('button', { name: /Claim pack/ }))

    expect(screen.queryByRole('button', { name: /build/i })).toBeNull()
    // And it says so, rather than going quiet about it.
    expect(screen.getByText(/can’t assemble the bundle yet/i)).toBeInTheDocument()
  })

  it('reads six Missing marks for the sparse thing, and still opens', async () => {
    render(<ClaimPack thing={detail()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Claim pack — 0 of 6 pieces' }))
    expect(screen.getAllByText('Missing')).toHaveLength(6)
    expect(screen.queryByText('In')).toBeNull()
  })
})

// ── Ownership ────────────────────────────────────────────────────────────────

describe('the away label', () => {
  it('reads as a sentence whether or not there is a name or a date', () => {
    // `ownership_who` is optional even when not `here` (things.md §3), so the comp's
    // `"Lent to " + a.who` prints "Lent to null" on a loan nobody named.
    expect(
      awayLabel({ ownership: 'lent', ownership_who: 'Priya', ownership_since: '2026-07-30' }),
    ).toBe('Lent to Priya · 30 Jul 2026')
    expect(
      awayLabel({ ownership: 'gone', ownership_who: 'Sam', ownership_since: '2026-07-30' }),
    ).toBe('Handed to Sam · 30 Jul 2026')
    /**
     * Unnamed reads as the comp's words — "someone" and "a new owner" (comp 2143) — **not** as the
     * `Lent out` / `Handed on` an earlier pass wrote. The distinction the code keeps is that these
     * pronouns are rendered, never stored: `OwnershipPanel` still writes `ownership_who: null`, which
     * `things.test.ts`'s write assertions pin from the other side.
     */
    expect(
      awayLabel({ ownership: 'lent', ownership_who: null, ownership_since: '2026-07-30' }),
    ).toBe('Lent to someone · 30 Jul 2026')
    expect(awayLabel({ ownership: 'gone', ownership_who: null, ownership_since: null })).toBe(
      'Handed to a new owner',
    )
    // A blank string is the same case as absent — never "Lent to  ".
    expect(awayLabel({ ownership: 'lent', ownership_who: '  ', ownership_since: null })).toBe(
      'Lent to someone',
    )
  })
})

describe('ownership on the screen', () => {
  it('shows no banner and offers the handover control while the thing is here', async () => {
    await renderDetail(detail())
    expect(screen.queryByText('With someone else')).toBeNull()
    expect(screen.queryByText('No longer yours')).toBeNull()
    expect(screen.getByRole('button', { name: 'It’s not with me any more' })).toBeInTheDocument()
  })

  it('banners a LENT thing, says reminders carry on, and offers to bring it back', async () => {
    await renderDetail(
      detail({ ownership: 'lent', ownership_who: 'Priya', ownership_since: '2026-07-30' }),
    )

    expect(screen.getByText('With someone else')).toBeInTheDocument()
    expect(screen.getByText('Lent to Priya · 30 Jul 2026')).toBeInTheDocument()
    // Rule 4: `lent` is still yours and its reminders carry on. The note has to say the true one.
    expect(screen.getByText(/reminders carry on/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'It’s back with me' })).toBeInTheDocument()
    // The handover control is gone — it is not with you, so there is nothing to hand over.
    expect(screen.queryByRole('button', { name: 'It’s not with me any more' })).toBeNull()
  })

  it('banners a GONE thing with the honest note about the paperwork', async () => {
    await renderDetail(
      detail({ ownership: 'gone', ownership_who: 'Sam', ownership_since: '2026-07-30' }),
    )

    expect(screen.getByText('No longer yours')).toBeInTheDocument()
    expect(screen.getByText('Handed to Sam · 30 Jul 2026')).toBeInTheDocument()
    // Two facts, both true and both easy to leave out: the documents stay, and this app transfers
    // nothing. Rule 5 and the comp's own sentence.
    expect(screen.getByText(/its documents stay in documents/i)).toBeInTheDocument()
    expect(screen.getByText(/separate job/i)).toBeInTheDocument()
    // "Undo" rather than "It's back with me": there is no event that reverses a sale.
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('sends the WHOLE TRIPLE and the version when marking a thing lent', async () => {
    const patched: unknown[] = []
    server.use(
      http.patch(`*/api/v1/things/${THING_ID}`, async ({ request }) => {
        patched.push(await request.json())
        return HttpResponse.json(detail({ ownership: 'lent', ownership_who: 'Priya', version: 2 }))
      }),
    )
    await renderDetail(detail())

    await userEvent.click(screen.getByRole('button', { name: 'It’s not with me any more' }))
    await userEvent.type(screen.getByLabelText('Who has it'), 'Priya')
    // The button relabels as you type, so the choice names the person it is about.
    await userEvent.click(screen.getByRole('button', { name: 'Lent to Priya — still mine' }))

    await waitFor(() => expect(patched).toHaveLength(1))
    /**
     * All three fields plus the version the screen was RENDERED at.
     *
     * The triple moves together (rule 4), and `PATCH` semantics are "an absent key means don't change" —
     * so a patch that set only `ownership` and trusted a server-side fix-up would be a client depending
     * on something it cannot see. The version is the ADR-0024 precondition.
     */
    expect(patched[0]).toEqual({
      version: 1,
      ownership: 'lent',
      ownership_who: 'Priya',
      ownership_since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    })
  })

  it('sends null rather than an invented name when nobody was named', async () => {
    const patched: unknown[] = []
    server.use(
      http.patch(`*/api/v1/things/${THING_ID}`, async ({ request }) => {
        patched.push(await request.json())
        return HttpResponse.json(detail({ ownership: 'gone', version: 2 }))
      }),
    )
    await renderDetail(detail())

    await userEvent.click(screen.getByRole('button', { name: 'It’s not with me any more' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sold or given away — new owner' }))

    await waitFor(() => expect(patched).toHaveLength(1))
    // The comp substitutes "a new owner" here, which invents a value the user declined to give and then
    // shows it back to them as fact. `''` would be a blank that is not absent (conventions/api.md §8).
    expect(patched[0]).toMatchObject({ ownership: 'gone', ownership_who: null })
  })

  it('CLEARS the triple when the thing comes back', async () => {
    const patched: unknown[] = []
    server.use(
      http.patch(`*/api/v1/things/${THING_ID}`, async ({ request }) => {
        patched.push(await request.json())
        return HttpResponse.json(detail({ version: 3 }))
      }),
    )
    await renderDetail(
      detail({
        ownership: 'lent',
        ownership_who: 'Priya',
        ownership_since: '2026-07-30',
        version: 2,
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'It’s back with me' }))

    await waitFor(() => expect(patched).toHaveLength(1))
    // Rule 4's third consequence: `ownership_who` and `ownership_since` cannot outlive `ownership`, and
    // they are cleared in the SAME statement — the same reason `relation` cannot outlive `holder`.
    expect(patched[0]).toEqual({
      version: 2,
      ownership: 'here',
      ownership_who: null,
      ownership_since: null,
    })
  })

  it('surfaces a refused write rather than appearing to have saved', async () => {
    server.use(
      http.patch(`*/api/v1/things/${THING_ID}`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Conflict',
            status: 409,
            detail: 'This record has changed.',
          },
          { status: 409 },
        ),
      ),
    )
    await renderDetail(detail())

    await userEvent.click(screen.getByRole('button', { name: 'It’s not with me any more' }))
    await userEvent.click(screen.getByRole('button', { name: 'Lent out — still mine' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This record has changed.')
    // Still open, so nothing typed is lost and what is on screen still matches the server.
    expect(screen.getByLabelText('Who has it')).toBeInTheDocument()
  })
})

// ── Delete ───────────────────────────────────────────────────────────────────

describe('deleting a thing', () => {
  it('sends the VERSION the screen was rendered at', async () => {
    const deleted: string[] = []
    server.use(
      http.delete(`*/api/v1/things/${THING_ID}`, ({ request }) => {
        deleted.push(new URL(request.url).search)
        return new HttpResponse(null, { status: 204 })
      }),
    )
    await renderDetail(detail({ version: 7 }))

    await userEvent.click(screen.getByRole('button', { name: 'Delete this thing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }))

    await waitFor(() => expect(deleted).toHaveLength(1))
    // Debt D41: a delete built against stale data must be refused with 409 rather than destroying an
    // edit made elsewhere. A query parameter, because `fetch` will not reliably send a DELETE body.
    expect(deleted[0]).toBe('?version=7')
  })

  it('says the documents survive, and does not promise a recovery it cannot make', async () => {
    await renderDetail(detail())
    await userEvent.click(screen.getByRole('button', { name: 'Delete this thing' }))

    // Rule 5's promise, in the copy, because a user who does not know it will not risk the tap.
    expect(screen.getByText(/documents stay in documents/i)).toBeInTheDocument()
    // And NOT the comp's "recoverable for 30 days" — there is no restore endpoint and no purge job.
    expect(screen.queryByText(/30 days/i)).toBeNull()
    expect(screen.queryByText(/recoverable/i)).toBeNull()
  })

  it('explains a 409 rather than leaving the tap looking ignored', async () => {
    server.use(
      http.delete(`*/api/v1/things/${THING_ID}`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Conflict', status: 409, detail: 'Stale version.' },
          { status: 409 },
        ),
      ),
    )
    await renderDetail(detail())

    await userEvent.click(screen.getByRole('button', { name: 'Delete this thing' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed somewhere else/i)
  })
})

// ── The whole screen ─────────────────────────────────────────────────────────

describe('the whole screen', () => {
  it('renders a thing with NOTHING BUT A NAME', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *  Business rule 1 / Q2, and the state every fixture misses (design.md §10).
     * ═══════════════════════════════════════════════════════════════════════════════════════
     *
     * No kind detail, no cover, no service cycle, no serial, no price, no photo, no documents. Each of
     * those is a branch, and a screen that only ever renders the seeded record proves nothing about any
     * of them.
     */
    await renderDetail(detail({ name: 'Thing in the loft' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Thing in the loft' })).toBeInTheDocument()
    // The kind still says something — `other` is "Thing", not a blank.
    expect(screen.getByText('Thing')).toBeInTheDocument()
    // Cover is absence, drawn as absence.
    expect(screen.getByText('No warranty recorded')).toBeInTheDocument()
    // The four fact rows are present as "Not set" rather than vanishing.
    expect(screen.getAllByText('Not set')).toHaveLength(4)
    // The sections with nothing to say say nothing: no service history, no serial card, no 2×2, no
    // photos. Their absence is the assertion.
    expect(screen.queryByText('Service history')).toBeNull()
    expect(screen.queryByText('Serial number')).toBeNull()
    expect(screen.queryByText('Papers this one needs')).toBeNull()
    expect(screen.queryByText('Photos')).toBeNull()
    // And the sections that always have something to say still do.
    expect(
      screen.getByText(/nothing filed against this yet\. a receipt or a warranty card/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Claim pack — 0 of 6 pieces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete this thing' })).toBeInTheDocument()
  })

  it('draws the holder as a pill, with the relation beside it', async () => {
    await renderDetail(detail({ holder: 'Priya', relation: 'Wife' }))
    expect(screen.getByText(/filed under priya · wife/i)).toBeInTheDocument()
  })

  /**
   * Its own test rather than a second render in the one above, and the reason is the cache.
   *
   * `queryClient` is per-**test**, and both renders would share the key `['things','detail',id]` — so the
   * second render reads the first record straight out of the cache and Priya's pill survives an
   * `unmount()`. That failed exactly once, in the useful direction.
   */
  it('draws NO pill at all for the owner’s own thing', async () => {
    // Rule 6: `null` means "mine" and is drawn as *absence*. There is no "Me" badge anywhere in the app.
    await renderDetail(detail({ holder: null }))
    expect(screen.queryByText(/filed under/i)).toBeNull()
    expect(screen.queryByText('Me')).toBeNull()
  })

  it('lists its documents, and the vehicle grid, on a full record', async () => {
    const { onFileAgainst } = await renderDetail(
      detail({
        name: 'Golf',
        kind: 'vehicle',
        brand: 'Volkswagen',
        model: 'Golf 1.5 TSI',
        serial: 'KA01AB1234',
        serial_last4: '1234',
        purchased_on: iso(-800),
        price: '1450000',
        currency: 'INR',
        kept_at: 'Driveway',
        warranty_ends_on: iso(-30),
        service_every_months: 12,
        service_due_on: iso(21),
        services: [service({ id: uuid('1'), serviced_on: '2025-08-01', provider: 'VW Kilburn' })],
        photos: [photo({ id: uuid('11'), is_hero: true })],
        documents: [
          linked({
            id: uuid('21'),
            title: 'Vehicle insurance',
            doc_type: 'financial',
            expires_on: iso(21),
          }),
        ],
      }),
    )

    expect(screen.getByText('Vehicle · Volkswagen · Golf 1.5 TSI')).toBeInTheDocument()
    expect(screen.getByText('Papers this one needs')).toBeInTheDocument()
    expect(screen.getByText('Its documents')).toBeInTheDocument()
    /**
     * "Registration" appears exactly TWICE, and that is the assertion rather than an accident: the 2×2's
     * first slot, and `SERIAL_LABELS.vehicle` on the serial card. Rule 8 is the reason the second one
     * exists — a bare `KA01AB1234` is a string nobody can identify.
     */
    expect(screen.getAllByText('Registration')).toHaveLength(2)
    // The price, formatted from ITS currency — the fixture is deliberately not British. Indian and
    // Western grouping differ, so both are accepted; the assertion is that a symbol and the digits
    // arrived, not which locale the test runner has.
    expect(screen.getByText(/1[,.]?4?5?0?[,.]?000/)).toBeInTheDocument()
    expect(screen.getByText('Driveway')).toBeInTheDocument()
    // A non-zero photo count, stated (debt D33).
    expect(screen.getByText('1 photo')).toBeInTheDocument()

    // The dashed invitation reaches capture with the THING attached and no type guessed for it.
    await userEvent.click(screen.getByRole('button', { name: 'File a document against this' }))
    expect(onFileAgainst).toHaveBeenCalledWith({ thing: { id: THING_ID, name: 'Golf' } })
  })

  it('sends the SLOT’s preset, title and thing to capture from an empty paper slot', async () => {
    /**
     * The §7 shortcut, end to end through the screen rather than only through the component.
     *
     * `preset` is what makes the wizard arrive already knowing the type, the issuer and the number's
     * label; `title` beats the preset's own name inside it; and `thing` is what drops the type step
     * entirely (`forThing`, ADR-0030's five-step variant). All three have to survive the composition,
     * and the component test alone cannot prove the route's half of it.
     */
    const { onFileAgainst } = await renderDetail(detail({ name: 'Golf', kind: 'vehicle' }))

    await userEvent.click(screen.getByRole('button', { name: 'File the registration for Golf' }))

    expect(onFileAgainst).toHaveBeenCalledWith({
      thing: { id: THING_ID, name: 'Golf' },
      // `Vehicle RC` is `legal`, not the `identity` the comp's `guessDoc()` returns — the preset in
      // `presets.ts` is the authority, and the slot agrees with it rather than with the prototype.
      preset: 'Vehicle RC',
      title: 'Registration — Golf',
    })
  })

  it('is CALM about a 404, and names the reason it is probably a 404 today', async () => {
    server.use(
      http.get(`*/api/v1/things/${THING_ID}`, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Not Found', status: 404, detail: 'Not found.' },
          { status: 404 },
        ),
      ),
    )
    await renderScreen(<ThingDetail thingId={THING_ID} onFileAgainst={vi.fn()} today={TODAY} />)

    expect(await screen.findByText('This thing isn’t here')).toBeInTheDocument()
    /**
     * Three causes it cannot tell apart — deleted, another space (invariant 4: never a 403), and Things
     * not being switched on at all (things.md §10), which is the actual one today. The copy names all
     * three and speculates about none.
     */
    expect(screen.getByText(/isn’t switched on yet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to things' })).toBeInTheDocument()
  })

  it('shows the server’s own sentence for a failure that is NOT a 404, with a real Retry', async () => {
    /**
     * A 400 rather than a 500, deliberately: `createQueryClient` retries a 5xx twice with a backoff, so a
     * 500 here would make the test wait on retries rather than on a render. A malformed id genuinely
     * produces this — `params/id must be a uuid` — so it is a real case, not a convenient one.
     */
    server.use(
      http.get(`*/api/v1/things/${THING_ID}`, () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Bad Request',
            status: 400,
            detail: 'params/id must match format "uuid".',
          },
          { status: 400 },
        ),
      ),
    )
    await renderScreen(<ThingDetail thingId={THING_ID} onFileAgainst={vi.fn()} today={TODAY} />)

    expect(await screen.findByText('Couldn’t load this thing')).toBeInTheDocument()
    // Never flattened into "not found", never swallowed (conventions/code.md §6).
    expect(screen.getByText('params/id must match format "uuid".')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

// ── Money ────────────────────────────────────────────────────────────────────

describe('formatting money', () => {
  it('takes the symbol from the record’s currency, never from a hardcoded £', () => {
    // The comp's `gbp()` writes `"£" + n.toLocaleString("en-GB")`. Its fixtures are British; the app is
    // not, and a rupee price rendered as pounds is a wrong number rather than a wrong decoration.
    expect(formatMoney('95.00', 'GBP')).toMatch(/£/)
    expect(formatMoney('45999', 'INR')).toMatch(/₹|INR/)
    expect(formatMoney('95.00', 'GBP')).not.toMatch(/₹/)
  })

  it('prints a bare number rather than guessing a symbol when there is no currency', () => {
    // No symbol, no code, no guess: an amount with no currency is incomplete data, and inventing a
    // symbol for it would hide that.
    const formatted = formatMoney('1234.5', null) ?? ''
    expect(formatted).toMatch(/1[,.\s]?234/)
    expect(formatted).not.toMatch(/[£$₹€]/)
  })

  it('says nothing at all when there is no amount', () => {
    expect(formatMoney(null, 'GBP')).toBeNull()
    expect(formatMoney(undefined, 'GBP')).toBeNull()
    expect(formatMoney('', 'GBP')).toBeNull()
  })

  it('keeps both facts on screen for a currency code Intl refuses', () => {
    /**
     * `Intl` throws `RangeError` only on a **malformed** code — not on an unknown one. `'ZZZ'` it formats
     * itself, as `ZZZ 1,000.00`; `'ZZ'` it rejects. Both are asserted, because the distinction is the
     * whole reason the `catch` in `money.ts` is narrower than it looks — and a thrown formatter takes
     * the screen down at the root error boundary over one bad field (debt D46).
     */
    expect(formatMoney('1000', 'ZZZ')).toMatch(/ZZZ/)
    expect(formatMoney('1000', 'ZZ')).toMatch(/ZZ$/)
  })
})

// ── Photos ───────────────────────────────────────────────────────────────────

/**
 * The hero and the strip, now that the photo endpoints exist (things.md §10, debt D59).
 *
 * The four things worth pinning are the four that were wrong or absent before, and each of them is a
 * behaviour rather than a layout:
 *
 *  1. **The hero mints exactly one presigned URL**, for the `is_hero` photo and no other. The list row's
 *     thumbnail is deliberately still not an image because that would be one presign per row.
 *  2. **A thing with no photo draws the picker**, not an empty frame — the comp's hero is a drop target.
 *  3. **The strip's tiles open the viewer**, minting the URL at the moment of the tap.
 *  4. **`make_hero` is `false` from the strip.** Confirming a `make_hero` row demotes its siblings, so an
 *     "add another photo" that defaulted to `true` would silently steal the main slot.
 */
describe('a thing’s photos', () => {
  const HERO = uuid('11')
  const SECOND = uuid('12')

  /** Records every presign body, so "exactly one, for the hero" is assertable rather than assumed. */
  function servePhotoBytes() {
    const asked: string[] = []
    server.use(
      /**
       * A **RegExp**, not a path string, and it is not a style choice.
       *
       * MSW matches path strings with `path-to-regexp`, where a `:` opens a parameter — so
       * `photos::presign-download` is parsed as a literal colon followed by a param called
       * `presign-download`, and it does not match the literal URL the client sends. The documents side
       * gets away with a string because its verbs carry a *single* colon. conventions/api.md §2 is why
       * the URL has two.
       */
      http.post(/\/photos::presign-download$/, async ({ request }) => {
        const body = (await request.json()) as { photo_id: string }
        asked.push(body.photo_id)
        return HttpResponse.json(
          {
            download_url: `https://r2.test/${body.photo_id}.jpg`,
            expires_at: '2026-07-30T13:00:00.000Z',
          },
          { status: 201 },
        )
      }),
    )
    return asked
  }

  it('draws the hero image and presigns ONE url — the hero’s, not every photo’s', async () => {
    const asked = servePhotoBytes()
    await renderDetail(
      detail({
        name: 'Bosch dishwasher',
        photos: [photo({ id: SECOND }), photo({ id: HERO, is_hero: true })],
      }),
    )

    const image = await screen.findByRole('img', { name: 'Bosch dishwasher' })
    expect(image).toHaveAttribute('src', `https://r2.test/${HERO}.jpg`)
    // One presign, and it is the hero's. Two would mean the strip had grown `<img>` tags.
    expect(asked).toEqual([HERO])
    // The strip still lists both, by count.
    expect(screen.getByText('2 photos')).toBeInTheDocument()
  })

  it('draws the picker instead of an empty frame when there is no photo', async () => {
    await renderDetail(detail({ photos: [] }))
    // The comp's own words on the wizard's photo step. An inert empty box would be furniture.
    expect(screen.getByRole('button', { name: /take a photo of it/i })).toBeInTheDocument()
    // And no strip: one invitation per screen, not two.
    expect(screen.queryByText('Photos')).toBeNull()
  })

  it('opens a strip tile in the viewer, minting its url on the tap', async () => {
    const asked = servePhotoBytes()
    await renderDetail(detail({ name: 'Boiler', photos: [photo({ id: HERO, is_hero: true })] }))
    await screen.findByRole('img', { name: 'Boiler' })
    expect(asked).toEqual([HERO])

    await userEvent.click(screen.getByRole('button', { name: /JPG/ }))

    // A real dialog — Escape closes it, focus is trapped, the page behind does not scroll.
    const viewer = await screen.findByRole('dialog')
    expect(viewer).toHaveAccessibleName('Boiler')
    // Minted again on the tap rather than reused: a presigned URL is short-lived and is never cached.
    expect(asked).toEqual([HERO, HERO])
  })

  it('adds a photo from the strip with make_hero FALSE, so it cannot steal the main slot', async () => {
    servePhotoBytes()
    const bodies: unknown[] = []
    server.use(
      // A RegExp for the same reason as the download handler above — the `::` in the path.
      http.post(/\/photos::presign-upload$/, async ({ request }) => {
        bodies.push(await request.json())
        return HttpResponse.json(
          {
            photo_id: SECOND,
            upload_url: 'https://r2.test/put',
            storage_key: 'spaces/x/things/y/z',
            expires_at: '2026-07-30T13:00:00.000Z',
          },
          { status: 201 },
        )
      }),
    )

    await renderDetail(detail({ name: 'Boiler', photos: [photo({ id: HERO, is_hero: true })] }))
    await screen.findByRole('img', { name: 'Boiler' })

    /**
     * The hidden `<input type="file">`, driven directly.
     *
     * `userEvent.upload` on the button would not reach it — the button calls `.click()` on the input, and
     * jsdom does not open a file dialog. The input is what the OS hands the file to, so the input is what
     * the test hands it to. `hidden` is a class, not the attribute, so it is still in the tree.
     */
    const input = document.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    await userEvent.upload(
      input as HTMLInputElement,
      new File(['bytes'], 'boiler.jpg', { type: 'image/jpeg' }),
    )

    await waitFor(() => expect(bodies).toHaveLength(1))
    expect(bodies[0]).toEqual({ mime: 'image/jpeg', size_bytes: 5, make_hero: false })
  })

  it('refuses a PDF before any bytes move, and says why', async () => {
    servePhotoBytes()
    await renderDetail(detail({ photos: [] }))

    /**
     * `fireEvent.change`, not `userEvent.upload`.
     *
     * `userEvent.upload` honours the input's own `accept` attribute and drops a file that does not match
     * it — which would make this test pass for the wrong reason, proving the browser's filter rather than
     * ours. `accept` is a *hint*: a share sheet, a drag-and-drop or a misreported mime all get past it,
     * which is why the component checks again. This is the path that arrives when it does.
     */
    const input = document.querySelector('input[type="file"]')
    expect(input).not.toBeNull()
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [new File(['bytes'], 'manual.pdf', { type: 'application/pdf' })] },
    })

    // Business rule 11: `ALLOWED_PHOTO_MIMES` is the image half of the document allowlist. A photo of a
    // boiler is not a PDF, and the refusal names the file's own type rather than a generic failure.
    expect(await screen.findByText(/application\/pdf.*isn’t supported/i)).toBeInTheDocument()
  })
})
