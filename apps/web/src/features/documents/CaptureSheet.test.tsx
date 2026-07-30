import type { Document, Thing } from '@life-manager/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { CaptureWizard, visibleSteps } from './CaptureSheet'
import {
  addMonths,
  coverEndsOn,
  EMPTY_DOCUMENT_DRAFT,
  EMPTY_THING_DRAFT,
  priceOf,
  savedFacts,
  savedGaps,
  thingName,
  toDocumentCreate,
  toThingCreate,
} from './captureTracks'

/**
 * The capture wizard. [ADR-0030](../../../../docs/decisions/0030-capture-as-a-stepped-wizard.md).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The test the ADR asks for BY NAME is `walks both tracks pressing Skip on every step`.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * ADR-0030 § Consequences: *"A wizard is a place where 'required' creeps back in. The single most
 * likely future regression is someone adding a validation guard to a step because a blank one looks
 * unfinished. The guard against it is a test that walks both tracks pressing Skip on every skippable
 * step and asserts a save."* That is `the skip walk` below, and it is the reason this file exists.
 *
 * Everything here goes through MSW rather than a mocked `lib/api`, so the real client and its real Zod
 * parse run — a payload the contract would reject fails here rather than in production.
 */

// ── Harness ──────────────────────────────────────────────────────────────────

const SPACE = '22222222-2222-4222-8222-222222222222'
const CREATED_ID = '00000009-0000-4000-8000-000000000009'

function documentFixture(overrides: Partial<Document> = {}): Document {
  return {
    id: CREATED_ID,
    space_id: SPACE,
    title: 'Saved thing',
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
    file_count: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  }
}

function thingFixture(overrides: Partial<Thing> = {}): Thing {
  return {
    id: CREATED_ID,
    space_id: SPACE,
    name: 'Saved thing',
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
    ...overrides,
  }
}

/**
 * Captures the body of the one create the test makes, so an assertion can be about **what was sent**
 * rather than about what the component believes it sent.
 *
 * A clearly separated MSW block: `apps/web/src/test/msw.ts` is being edited concurrently by the
 * session building Things, so nothing here touches it.
 */
function interceptCreates() {
  const sent: { documents: unknown[]; things: unknown[] } = { documents: [], things: [] }
  server.use(
    http.post('*/api/v1/documents', async ({ request }) => {
      const body = await request.json()
      sent.documents.push(body)
      const typed = body as { title?: string }
      return HttpResponse.json(documentFixture({ title: typed.title ?? 'Untitled' }), {
        status: 201,
      })
    }),
    http.post('*/api/v1/things', async ({ request }) => {
      const body = await request.json()
      sent.things.push(body)
      const typed = body as { name?: string }
      return HttpResponse.json(thingFixture({ name: typed.name ?? 'Unnamed' }), { status: 201 })
    }),
  )
  return sent
}

/**
 * The wizard needs a router (the saved step navigates to a document) and a Query client (the
 * mutations). `router.load()` is awaited because `RouterProvider` renders nothing until the first
 * match resolves.
 */
async function renderWizard(
  props: Partial<Parameters<typeof CaptureWizard>[0]> = {},
): Promise<{ onDone: () => void; onCancel: () => void }> {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  const rootRoute = createRootRoute({
    component: () => (
      <QueryClientProvider client={createQueryClient()}>
        <CaptureWizard onCancel={onCancel} onDone={onDone} {...props} />
      </QueryClientProvider>
    ),
  })
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents/$documentId',
    component: () => null,
  })
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detail, list]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router as never} />)
  return { onDone, onCancel }
}

const skip = () => screen.getByRole('button', { name: 'Skip for now' })
const continueOn = () => screen.getByRole('button', { name: 'Continue' })

// ── The one that matters ─────────────────────────────────────────────────────

describe('the skip walk', () => {
  it('saves a DOCUMENT after skipping every step but the title — ADR-0030, and Q2', async () => {
    const sent = interceptCreates()
    await renderWizard()

    // type → whose → title. Both are skippable, and Skip is *drawn* on both: a step whose only
    // forward control says "Continue" reads as a step you are expected to fill in.
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    await userEvent.click(skip())
    await userEvent.click(skip())

    // The ONE required field in the whole track. Nothing else on either track is required, ever.
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Title'), 'Dishwasher receipt')
    await userEvent.click(continueOn())

    // number → dates → scan, all skipped.
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.documents).toHaveLength(1))
    expect(sent.documents[0]).toMatchObject({
      title: 'Dishwasher receipt',
      // `other` is the absence of a type, not an error state — Q2's stated cost, which the list and
      // detail screens already render as a normal case.
      doc_type: 'other',
      issuer: null,
      identifier: null,
      holder: null,
      expires_on: null,
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('saves a THING after skipping every step but its lead field', async () => {
    const sent = interceptCreates()
    await renderWizard({ intent: { track: 'thing' } })

    // kind, skipped — so the payload takes `thingCreateSchema`'s `other` default.
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    await userEvent.click(skip())

    expect(screen.queryByRole('button', { name: 'Skip for now' })).toBeNull()
    await userEvent.type(screen.getByLabelText('What it is'), 'Gold chain')
    await userEvent.click(continueOn())

    // detail → purchase → warranty → photo.
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.things).toHaveLength(1))
    expect(sent.things[0]).toMatchObject({
      name: 'Gold chain',
      kind: 'other',
      brand: null,
      serial: null,
      purchased_on: null,
      price: null,
      currency: null,
      warranty_ends_on: null,
    })
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('draws a Skip on every step except the required one, on both tracks', async () => {
    // The structural version of the two walks above: it counts the steps that offer a skip rather
    // than trusting the walk to have visited them all. Five of six, twice.
    for (const track of ['document', 'thing'] as const) {
      const { unmount } = render(<div />)
      unmount()
      await renderWizard({ intent: { track } })

      let skippable = 0
      const total = visibleSteps(track, false).length
      expect(total).toBe(6)

      for (let step = 0; step < total; step += 1) {
        const hasSkip =
          screen.queryByRole('button', { name: 'Skip for now' }) !== null ||
          screen.queryByRole('button', { name: 'Save without a photo' }) !== null
        if (hasSkip) skippable += 1
        // Fill the required step so the walk can get past it, then move on.
        if (!hasSkip) {
          const field = track === 'document' ? 'Title' : 'What it is'
          await userEvent.type(screen.getByLabelText(field), 'Something')
          await userEvent.click(continueOn())
        } else if (step < total - 1) {
          await userEvent.click(skip())
        }
      }
      expect(skippable).toBe(5)
      screen.getByText(/Step 6 of 6/)
      document.body.innerHTML = ''
    }
  })
})

// ── Choice steps advance on tap ──────────────────────────────────────────────

describe('a tap on a choice step advances it', () => {
  it('picks a preset, fills three fields and moves on in ONE tap', async () => {
    // design.md §6 and ADR-0030's first capture-budget mitigation. "Choose, then press Continue" is
    // two taps for one decision.
    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar' }))

    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Whose document is it?' })).toBeInTheDocument()

    // ...and the title arrived prefilled, which is what makes the fast path four taps.
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Aadhaar')
    // The number step is named after the document, not "Identifier".
    await userEvent.click(continueOn())
    expect(screen.getByLabelText('Aadhaar number')).toBeInTheDocument()
  })

  it('picks a broad type and moves on, with no Other pill to pick', async () => {
    const sent = interceptCreates()
    await renderWizard()

    // `other` is the absence of a type. Six pills, not seven — a filled ink "Other" would make the
    // row read as answered before anything was chosen.
    expect(screen.queryByRole('button', { name: 'Other' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Certificate' }))
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()

    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), 'First aid certificate')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.documents).toHaveLength(1))
    expect(sent.documents[0]).toMatchObject({ doc_type: 'certificate' })
  })

  it('picks a kind and moves on, and the kind decides what is asked for next', async () => {
    await renderWizard({ intent: { track: 'thing' } })
    await userEvent.click(screen.getByRole('button', { name: 'Vehicle' }))

    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
    // A vehicle's lead field is its make; a valuable's is the thing itself. That conditionality is
    // ADR-0030's stated reason for the wizard existing at all.
    expect(screen.getByLabelText('Make')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Make'), 'Tata')
    await userEvent.click(continueOn())
    // ...and the serial's LABEL follows the kind — things.md §4 rule 8.
    expect(screen.getByLabelText('Registration')).toBeInTheDocument()
  })

  it('names a holder in one tap and sends it as a label', async () => {
    server.use(
      http.get('*/api/v1/documents/holders', () =>
        HttpResponse.json({ data: [{ holder: 'Priya', relation: 'Wife' }] }),
      ),
    )
    const sent = interceptCreates()
    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Priya' }))
    expect(screen.getByText('Step 3 of 6')).toBeInTheDocument()

    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.documents).toHaveLength(1))
    // The relation rides along with the person, and neither is a permission — documents.md §4 rule 13.
    expect(sent.documents[0]).toMatchObject({ holder: 'Priya', relation: 'Wife' })
  })
})

// ── State that must survive a step boundary ──────────────────────────────────

describe('stepping back', () => {
  it('does not clear what was typed', async () => {
    // ADR-0030 § Consequences: "Skipping forward past a step and coming back must not clear what was
    // typed." The step machine moves an index and nothing else.
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), 'Bike papers')
    await userEvent.click(continueOn())
    await userEvent.type(screen.getByLabelText('Number'), 'AV-4471-9820')

    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Bike papers')

    await userEvent.click(continueOn())
    expect(screen.getByLabelText('Number')).toHaveValue('AV-4471-9820')
  })

  it('draws no Back on the first step, and Back on every step after it', async () => {
    await renderWizard()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    await userEvent.click(skip())
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument()
  })

  it('carries a compatible number across the preset change, and clears an incompatible one', async () => {
    /**
     * `carryNumber`'s rule, now holding across a **step boundary** rather than within one step — which
     * ADR-0030 calls out specifically. The number is typed on step four and the preset is changed on
     * step one, two steps earlier.
     */
    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))
    await userEvent.click(continueOn())
    await userEvent.type(screen.getByLabelText('Aadhaar number'), '999988887777')
    expect(screen.getByLabelText('Aadhaar number')).toHaveValue('9999 8888 7777')

    // Back to the type step — number → title → whose → type — and on to a shape that cannot hold
    // twelve digits.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'PAN card' }))
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))
    await userEvent.click(continueOn())
    // Cleared, not reshaped. Five stray characters under a label reading "PAN" is a value nobody typed.
    expect(screen.getByLabelText('PAN')).toHaveValue('')
  })
})

// ── Progress ─────────────────────────────────────────────────────────────────

describe('progress is drawn and honest', () => {
  it('counts six steps and fills one tick per step', async () => {
    const { container } = render(<div />)
    container.remove()
    await renderWizard()

    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
    expect(filledTicks()).toBe(1)
    expect(totalTicks()).toBe(6)

    await userEvent.click(skip())
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument()
    expect(filledTicks()).toBe(2)
  })

  it('drops to FIVE steps and five ticks when filing against a thing', async () => {
    /**
     * ADR-0030: *"When capture is launched against a thing… the first step is already answered, so the
     * count drops to five and the ticks drop the first segment rather than showing a step the user will
     * never see."* The count and the ticks both read `visibleSteps`, so they cannot disagree.
     */
    await renderWizard({
      intent: {
        track: 'document',
        forThing: { id: SPACE, name: 'Tata Nexon' },
        preset: 'Vehicle RC',
      },
    })

    expect(screen.getByText('Step 1 of 5')).toBeInTheDocument()
    expect(totalTicks()).toBe(5)
    // The step that was answered for us is not drawn: the first step is now *whose*.
    expect(screen.getByRole('heading', { name: 'Whose document is it?' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aadhaar' })).toBeNull()
    // ...and the chip says what it is being filed against.
    expect(screen.getByText('Filing against Tata Nexon')).toBeInTheDocument()
  })

  it('sends the thing_id it was opened against, and the prefilled title', async () => {
    const sent = interceptCreates()
    await renderWizard({
      intent: {
        track: 'document',
        forThing: { id: SPACE, name: 'Tata Nexon' },
        preset: 'Vehicle RC',
        title: 'Registration — Tata Nexon',
      },
    })

    await userEvent.click(skip())
    expect(screen.getByLabelText('Title')).toHaveValue('Registration — Tata Nexon')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.documents).toHaveLength(1))
    expect(sent.documents[0]).toMatchObject({
      title: 'Registration — Tata Nexon',
      thing_id: SPACE,
      doc_type: 'legal',
      issuer: 'Regional Transport Office',
    })
  })
})

function ticks(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[aria-hidden="true"] > div'))
}
function totalTicks(): number {
  return ticks().length
}
function filledTicks(): number {
  return ticks().filter((tick) => tick.className.includes('bg-ink')).length
}

// ── The two plate series, in the field ───────────────────────────────────────

describe('the number step, for a vehicle registration', () => {
  it('offers both series and formats each one', async () => {
    const sent = interceptCreates()
    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Vehicle RC' }))
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))
    await userEvent.click(continueOn())

    const field = screen.getByLabelText('Registration number')
    await userEvent.type(field, 'ka01ab1234')
    expect(field).toHaveValue('KA 01 AB 1234')
    // No completeness counter: two series of different lengths have no single "of N".
    expect(screen.queryByText(/of 1[01]/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /Bharat/ }))
    // A state plate cannot be reshaped into the BH series without losing four digits, so it clears
    // rather than leaving a plausible, wrong registration behind.
    expect(screen.getByLabelText('Registration number')).toHaveValue('')

    await userEvent.type(screen.getByLabelText('Registration number'), '22bh1234aa')
    // The regression: this was untypeable under the old `AA##AA####` mask.
    expect(screen.getByLabelText('Registration number')).toHaveValue('22 BH 1234 AA')

    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.documents).toHaveLength(1))
    expect(sent.documents[0]).toMatchObject({ identifier: '22 BH 1234 AA' })
  })

  it('formats a vehicle thing’s registration the same way, on the detail step', async () => {
    const sent = interceptCreates()
    await renderWizard({ intent: { track: 'thing' } })
    await userEvent.click(screen.getByRole('button', { name: 'Vehicle' }))
    await userEvent.type(screen.getByLabelText('Make'), 'Tata')
    await userEvent.click(continueOn())

    await userEvent.click(screen.getByRole('button', { name: /Bharat/ }))
    await userEvent.type(screen.getByLabelText('Registration'), '22bh1234aa')
    expect(screen.getByLabelText('Registration')).toHaveValue('22 BH 1234 AA')

    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    await waitFor(() => expect(sent.things).toHaveLength(1))
    expect(sent.things[0]).toMatchObject({
      kind: 'vehicle',
      brand: 'Tata',
      serial: '22 BH 1234 AA',
    })
  })
})

// ── The saved step ───────────────────────────────────────────────────────────

describe('the saved step', () => {
  it('reads back the facts and names what is blank', async () => {
    interceptCreates()
    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Passport' }))
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))
    await userEvent.click(continueOn())
    await userEvent.type(screen.getByLabelText('Passport number'), 'M1234567')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    // The readback. A confirmation that only said "Saved" would make a person reopen the record to
    // find out whether the number went in.
    expect(screen.getByText('Document')).toBeInTheDocument()
    // Three times over: the heading, the `Document` fact and the `Title` fact. All three are meant to
    // be there, which is why this asserts the count rather than a single node.
    expect(screen.getAllByText('Passport')).toHaveLength(3)
    expect(screen.getByText('Mine')).toBeInTheDocument()
    // ...and the number is read back as its MASK, as it is everywhere else in the app (ADR-0026).
    expect(screen.getByText('•••• 4567')).toBeInTheDocument()
    expect(screen.queryByText('M1234567')).toBeNull()
    // The gap sentence: a passport usually expires, and no date was given.
    expect(screen.getByText(/Still blank: expiry date\./)).toBeInTheDocument()
    expect(screen.getByText(/It’s in Documents\./)).toBeInTheDocument()
  })

  it('offers the id-dependent actions when the create reached the server', async () => {
    interceptCreates()
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), 'Dishwasher receipt')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    expect(await screen.findByRole('button', { name: 'Attach a scan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add an expiry date' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add another document' })).toBeInTheDocument()
  })

  it('drops them when the create was QUEUED offline, and still shows the saved step', async () => {
    /**
     * ADR-0024. A document created offline has no server id until it replays, so there is nothing to
     * link to — and an action that cannot work is worse than an action that is not offered. The saved
     * step still appears, because the record really was saved.
     *
     * `OfflineError` is what `writeOrQueue` recognises, and a network-level failure is what produces
     * it — hence `error()` rather than a status code, which would prove the request *did* reach the
     * server and must not be queued.
     */
    server.use(http.post('*/api/v1/documents', () => HttpResponse.error()))
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), 'Dishwasher receipt')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByText(/Saved on this device/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Attach a scan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add an expiry date' })).toBeNull()
    // "Add another" survives: the outbox takes as many as quota allows.
    expect(screen.getByRole('button', { name: 'Add another document' })).toBeInTheDocument()
  })

  it('says which collection a thing went into, and offers no scan action', async () => {
    interceptCreates()
    await renderWizard({ intent: { track: 'thing' } })
    await userEvent.click(screen.getByRole('button', { name: 'Laptop' }))
    await userEvent.type(screen.getByLabelText('Make'), 'Apple')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    expect(await screen.findByText(/It’s in Things\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add another thing' })).toBeInTheDocument()
    // A thing's photo endpoints do not exist yet (things.md §10), so there is no id-dependent action.
    expect(screen.queryByRole('button', { name: 'Attach a scan' })).toBeNull()
  })

  it('surfaces the server’s own sentence when it refuses, and loses nothing', async () => {
    server.use(
      http.post('*/api/v1/documents', () =>
        HttpResponse.json(
          {
            type: 'about:blank',
            title: 'Unprocessable Entity',
            status: 422,
            detail: 'Title must be 200 characters or fewer.',
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    )
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), 'Dishwasher receipt')
    await userEvent.click(continueOn())
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.click(screen.getByRole('button', { name: 'Save without a photo' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Title must be 200 characters or fewer.')).toBeInTheDocument()
    // Still on the scan step with everything intact — nothing is ever retyped (ADR-0025 §5).
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Dishwasher receipt')
  })
})

// ── Copy that must not drift ─────────────────────────────────────────────────

describe('the number step’s copy', () => {
  it('never claims the number is encrypted, because it is not', async () => {
    // Invariant 7 and ADR-0009 keep application-level encryption for the vault; the comp's own text
    // says "Stored in full and encrypted", and that is one of the places this deliberately deviates.
    // Debt D44. The same test exists for `IdentifierCard`.
    await renderWizard()
    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))
    await userEvent.click(continueOn())

    expect(screen.queryByText(/encrypted/i)).toBeNull()
    expect(screen.getByText(/Stored in full/)).toBeInTheDocument()
  })

  it('never claims a thing’s serial is encrypted either', async () => {
    await renderWizard({ intent: { track: 'thing' } })
    await userEvent.click(screen.getByRole('button', { name: 'Laptop' }))
    await userEvent.type(screen.getByLabelText('Make'), 'Apple')
    await userEvent.click(continueOn())

    expect(screen.queryByText(/encrypted/i)).toBeNull()
    expect(screen.getByText(/Stored in full/)).toBeInTheDocument()
  })
})

describe('the escape hatch to the other track', () => {
  it('switches to the thing track from the first step, and keeps the document draft', async () => {
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), 'Half-typed')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    await userEvent.click(screen.getByRole('button', { name: 'Add a thing' }))
    expect(screen.getByRole('heading', { name: 'What kind of thing is it?' })).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument()
  })

  it('is offered on the type step only, because that is the step that asks the question', async () => {
    await renderWizard()
    expect(screen.getByRole('button', { name: 'Add a thing' })).toBeInTheDocument()
    await userEvent.click(skip())
    expect(screen.queryByRole('button', { name: 'Add a thing' })).toBeNull()
  })
})

describe('Continue', () => {
  it('is dead on the required step at zero characters and live from the first', async () => {
    // The capture budget (ADR-0025 §5): live from character one, so the user never has to look at the
    // button to find out whether they are finished.
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())

    expect(continueOn()).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Title'), 'P')
    expect(continueOn()).toBeEnabled()
  })

  it('is never dead on any other step', async () => {
    await renderWizard()
    expect(continueOn()).toBeEnabled()
    await userEvent.click(skip())
    expect(continueOn()).toBeEnabled()
  })

  it('does not accept a title of nothing but spaces', async () => {
    await renderWizard()
    await userEvent.click(skip())
    await userEvent.click(skip())
    await userEvent.type(screen.getByLabelText('Title'), '   ')
    expect(continueOn()).toBeDisabled()
  })
})

// ── The pure half ────────────────────────────────────────────────────────────

describe('toDocumentCreate', () => {
  it('turns an empty draft plus a title into a payload the contract accepts', () => {
    const payload = toDocumentCreate({ ...EMPTY_DOCUMENT_DRAFT, title: 'Passport' })
    // `''` would store an empty string where the user meant nothing — a blank that is not absent, and
    // which sorts differently (conventions/api.md §8).
    expect(payload).toMatchObject({
      title: 'Passport',
      doc_type: 'other',
      issuer: null,
      identifier: null,
      holder: null,
      relation: null,
      issued_on: null,
      expires_on: null,
      country: null,
    })
  })

  it('never sends a relation without a holder', () => {
    // documents.md §4 rule 13: `relation` cannot outlive `holder`. One expression writes both.
    const payload = toDocumentCreate({
      ...EMPTY_DOCUMENT_DRAFT,
      title: 'Aadhaar',
      holder: '',
      relation: 'Wife',
    })
    expect(payload.relation).toBeNull()
  })

  it('uppercases a country code so the server does not reject it', () => {
    const payload = toDocumentCreate({ ...EMPTY_DOCUMENT_DRAFT, title: 'Passport', country: 'in' })
    expect(payload.country).toBe('IN')
  })
})

describe('toThingCreate', () => {
  it('turns an empty draft plus a lead field into a payload the contract accepts', () => {
    const payload = toThingCreate({ ...EMPTY_THING_DRAFT, lead: 'Gold chain' })
    expect(payload).toMatchObject({ name: 'Gold chain', kind: 'other', brand: null, price: null })
  })

  it('composes the name from make and model, and stores the make as the brand', () => {
    const draft = {
      ...EMPTY_THING_DRAFT,
      kind: 'vehicle' as const,
      lead: 'Tata',
      model: 'Nexon',
    }
    // A make alone is not the name of a thing you own. `isMake` is what decides this.
    expect(thingName(draft)).toBe('Tata Nexon')
    expect(toThingCreate(draft)).toMatchObject({ name: 'Tata Nexon', brand: 'Tata', model: 'Nexon' })
  })

  it('keeps a valuable’s own words as its name and stores no brand', () => {
    const draft = {
      ...EMPTY_THING_DRAFT,
      kind: 'valuable' as const,
      lead: 'Gold chain',
      model: '22ct, 18 inch',
    }
    expect(thingName(draft)).toBe('Gold chain')
    expect(toThingCreate(draft)).toMatchObject({
      name: 'Gold chain',
      brand: null,
      model: '22ct, 18 inch',
    })
  })

  it('pairs a price with a currency, and sends neither without the other', () => {
    // conventions/data.md §4: money is a decimal string plus a currency, never a float and never one
    // without the other.
    expect(toThingCreate({ ...EMPTY_THING_DRAFT, lead: 'Telly', price: '₹1,149' })).toMatchObject({
      price: '1149',
      currency: 'INR',
    })
    expect(toThingCreate({ ...EMPTY_THING_DRAFT, lead: 'Telly' })).toMatchObject({
      price: null,
      currency: null,
    })
    expect(priceOf({ ...EMPTY_THING_DRAFT, price: '1149.50' })).toBe('1149.50')
  })
})

describe('coverEndsOn', () => {
  it('counts the chosen length from the purchase date', () => {
    expect(
      coverEndsOn({ ...EMPTY_THING_DRAFT, purchasedOn: '2026-06-14', coverMonths: 36 }),
    ).toBe('2029-06-14')
  })

  it('treats "No cover" as an answer, not a blank', () => {
    expect(
      coverEndsOn({ ...EMPTY_THING_DRAFT, purchasedOn: '2026-06-14', coverMonths: 0 }),
    ).toBeNull()
  })

  it('NEVER counts from today when there is no purchase date', () => {
    /**
     * The date this refuses to invent. A dishwasher bought three years ago with a two-year warranty
     * would come out covered until 2028 if today stood in for the missing date — a fabricated value in
     * the one column the cover ladder reads.
     */
    expect(coverEndsOn({ ...EMPTY_THING_DRAFT, coverMonths: 24 })).toBeNull()
    // The step asks for the end date instead, and that is what is used.
    expect(
      coverEndsOn({ ...EMPTY_THING_DRAFT, coverMonths: 24, coverEndsOn: '2028-03-01' }),
    ).toBe('2028-03-01')
  })

  it('clamps to the end of the target month rather than rolling over', () => {
    // 31 January plus one month is 28 February, not 3 March. A warranty ending two days after the
    // month it should is a date nobody typed.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-08-15', 12)).toBe('2027-08-15')
  })
})

describe('savedFacts and savedGaps', () => {
  it('reads back only what the record holds', () => {
    const facts = savedFacts(
      'document',
      { ...EMPTY_DOCUMENT_DRAFT, preset: 'Aadhaar', title: 'Aadhaar', identifier: '9999 8888 7777' },
      EMPTY_THING_DRAFT,
    )
    // Non-zero, and exact — an empty list here would make the readback silently useless (D33).
    expect(facts).toHaveLength(4)
    expect(facts).toEqual([
      { key: 'Document', value: 'Aadhaar' },
      { key: 'Whose', value: 'Mine' },
      { key: 'Title', value: 'Aadhaar' },
      { key: 'Aadhaar number', value: '•••• 7777', mono: true },
    ])
  })

  it('names the blanks, and says the record works without them', () => {
    const gaps = savedGaps(
      'document',
      { ...EMPTY_DOCUMENT_DRAFT, title: 'Dishwasher receipt' },
      EMPTY_THING_DRAFT,
    )
    expect(gaps).toBe(
      'Still blank: number, type. Add any of it later — the record works without.',
    )
  })

  it('does not nag about an expiry a document never has — Q1', () => {
    // An Aadhaar number does not expire. Listing its missing expiry date would be the app inventing an
    // obligation; a document with no expiry is a normal silent case, not missing data.
    const aadhaar = savedGaps(
      'document',
      { ...EMPTY_DOCUMENT_DRAFT, preset: 'Aadhaar', title: 'Aadhaar', identifier: '9999' },
      EMPTY_THING_DRAFT,
    )
    expect(aadhaar).toBe('')

    // A passport does expire, so the blank date is worth naming.
    const passport = savedGaps(
      'document',
      { ...EMPTY_DOCUMENT_DRAFT, preset: 'Passport', title: 'Passport', identifier: 'M1234567' },
      EMPTY_THING_DRAFT,
    )
    expect(passport).toBe(
      'Still blank: expiry date. Add any of it later — the record works without.',
    )
  })

  it('names a vehicle’s missing registration, and a thing’s missing money', () => {
    const gaps = savedGaps('thing', EMPTY_DOCUMENT_DRAFT, {
      ...EMPTY_THING_DRAFT,
      kind: 'vehicle',
      lead: 'Tata',
    })
    expect(gaps).toBe(
      'Still blank: purchase date, price, warranty, registration. Add any of it later — the record works without.',
    )
  })

  it('says nothing at all when a thing was filled in', () => {
    const gaps = savedGaps('thing', EMPTY_DOCUMENT_DRAFT, {
      ...EMPTY_THING_DRAFT,
      kind: 'laptop',
      lead: 'Apple',
      serial: 'C02XL0RTJGH7',
      purchasedOn: '2026-01-01',
      price: '1149',
      coverMonths: 24,
    })
    expect(gaps).toBe('')
  })
})

describe('visibleSteps', () => {
  it('is six steps per track, and five for a document filed against a thing', () => {
    expect(visibleSteps('document', false)).toHaveLength(6)
    expect(visibleSteps('thing', false)).toHaveLength(6)
    expect(visibleSteps('document', true)).toHaveLength(5)
    // The dropped one is the FIRST, not any old one: the type is what the checklist already knows.
    expect(visibleSteps('document', true)[0]).toBe('whose')
    // `forThing` means nothing on the thing track — there is no thing to file a thing against.
    expect(visibleSteps('thing', true)).toHaveLength(6)
  })
})
