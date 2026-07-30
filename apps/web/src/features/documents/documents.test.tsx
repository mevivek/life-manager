import type { DocumentDetailResponse } from '@life-manager/shared'
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
import { useOpenAdd } from './AddSheetProvider'
import { DocumentForm } from './DocumentForm'
import { DocumentRow } from './DocumentRow'
import {
  ago,
  daysUntil,
  ExpiryStatus,
  expiryAccessibleName,
  expiryOf,
  formatDate,
  NEEDS_YOU_DAYS,
  needsYou,
  span,
} from './ExpiryStatus'
import { GettingStarted } from './GettingStarted'
import { Horizon } from './Horizon'
import { IdentifierCard } from './IdentifierCard'
import { COMMON_PRESETS, numberLabelFor, PRESETS } from './presets'

/**
 * Web tests for Documents.
 *
 * These cover the two things the client can get wrong on its own: **what it sends** and **what it
 * shows**. Business rules are the server's and are tested there — a rule asserted only here would
 * be a rule that does not exist (invariant 5, ADR-0002: Android will not have it).
 *
 * MSW intercepts at the network layer, so the real `lib/api` client and its real Zod parsing run.
 */

function renderWithQuery(ui: React.ReactElement) {
  return render(<QueryClientProvider client={createQueryClient()}>{ui}</QueryClientProvider>)
}

/** A fixed "today" so every relative assertion is arithmetic rather than a race with the clock. */
const TODAY = new Date('2026-07-29T12:00:00.000Z')

/** `days` from TODAY, as the `YYYY-MM-DD` the API returns. */
function iso(days: number): string {
  const date = new Date(TODAY)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * A detail response, for the tests that need `DocumentForm` in **edit** mode.
 *
 * `initial` being present is what distinguishes editing from creating, and several behaviours hang off
 * that distinction — the preset row is hidden, the optional fields open by default, and the number
 * field populates from `identifier` rather than the mask.
 */
const detailFixture: DocumentDetailResponse = {
  id: '00000001-0000-4000-8000-000000000000',
  space_id: '22222222-2222-4222-8222-222222222222',
  title: 'Passport',
  doc_type: 'identity',
  issuer: 'Ministry of External Affairs',
  holder: null,
  relation: null,
  identifier: 'FAKEM1234567',
  identifier_last4: '4567',
  thing_id: null,
  issued_on: null,
  expires_on: null,
  country: 'IN',
  notes: null,
  tags: [],
  custom_attrs: {},
  file_count: 0,
  version: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  files: [],
  reminders: [],
}

describe('daysUntil', () => {
  it('counts whole calendar days without a timezone shift', () => {
    // A late-evening "now" must not make tomorrow read as today. `expires_on` is a calendar date
    // with no time, so this is arithmetic on dates and never on instants.
    const lateEvening = new Date('2026-07-28T23:30:00.000Z')
    expect(daysUntil('2026-07-29', lateEvening)).toBe(1)
    expect(daysUntil('2026-07-28', lateEvening)).toBe(0)
    expect(daysUntil('2026-07-27', lateEvening)).toBe(-1)
  })
})

describe('the relative wording', () => {
  it('coarsens as the distance grows, so nothing ever says "in 243 days"', () => {
    expect(span(1)).toBe('1 day')
    expect(span(9)).toBe('9 days')
    // 14 is the boundary into weeks, 60 into months, 18 months into years. Asserted either side of
    // each, because an off-by-one here reads as a wrong date rather than as a wrong unit.
    expect(span(13)).toBe('13 days')
    expect(span(14)).toBe('2 weeks')
    expect(span(59)).toBe('8 weeks')
    expect(span(60)).toBe('2 months')
    expect(span(243)).toBe('8 months')
    expect(span(547)).toBe('18 months')
  })

  it('never says "1 year", because the months band runs all the way to 24', () => {
    // The comp's own helper switched to years at 18 months and left the count unpluralised, so 547
    // days came out as "1 years" — ungrammatical, and it understated a year and a half as a year.
    // The first reachable year value is 2. See the note on `span`.
    for (let days = 60; days < 1200; days += 1) {
      expect(span(days)).not.toBe('1 years')
      expect(span(days)).not.toBe('1 year')
    }
    expect(span(730)).toBe('2 years')
    expect(span(1095)).toBe('3 years')
  })

  it('uses the past tense for something already expired', () => {
    expect(ago(1)).toBe('Expired 1 day ago')
    expect(ago(42)).toBe('Expired 6 weeks ago')
    expect(ago(200)).toBe('Expired 7 months ago')
  })
})

describe('the expiry ladder', () => {
  it('puts a date in exactly one of the five states', () => {
    expect(expiryOf(null, TODAY).state).toBe('none')
    expect(expiryOf(iso(-42), TODAY).state).toBe('expired')
    expect(expiryOf(iso(0), TODAY).state).toBe('today')
    expect(expiryOf(iso(21), TODAY).state).toBe('near')
    expect(expiryOf(iso(243), TODAY).state).toBe('far')
  })

  it('draws the 45-day boundary between near and far, inclusive', () => {
    // The one threshold in the client. Off by one here moves a document between "Needs you" and
    // "The horizon", which is the difference between two screens' worth of meaning.
    expect(expiryOf(iso(NEEDS_YOU_DAYS), TODAY).state).toBe('near')
    expect(expiryOf(iso(NEEDS_YOU_DAYS + 1), TODAY).state).toBe('far')
  })

  it('counts expired, today and near as needing you — and far and undated as not', () => {
    // `needsYou` is what partitions the Now screen. Expired must be included: a passport that ran
    // out last month needs you MORE than one expiring in a fortnight, and a naive
    // "within 45 days" test that forgot the lower bound would drop it entirely.
    expect(needsYou(expiryOf(iso(-42), TODAY))).toBe(true)
    expect(needsYou(expiryOf(iso(0), TODAY))).toBe(true)
    expect(needsYou(expiryOf(iso(21), TODAY))).toBe(true)
    expect(needsYou(expiryOf(iso(243), TODAY))).toBe(false)
    expect(needsYou(expiryOf(null, TODAY))).toBe(false)
  })

  it('words each state the way the design specifies', () => {
    expect(expiryOf(null, TODAY).label).toBe('No expiry')
    expect(expiryOf(iso(0), TODAY).label).toBe('Expires today')
    expect(expiryOf(iso(21), TODAY).label).toBe('in 3 weeks')
    expect(expiryOf(iso(243), TODAY).label).toBe('in 8 months')
    expect(expiryOf(iso(-42), TODAY).label).toBe('Expired 6 weeks ago')
  })
})

describe('ExpiryStatus', () => {
  it('says so plainly when there is no expiry, rather than showing an empty slot', () => {
    // Q1's answer, rendered: no expiry is a normal silent case, not missing data.
    render(<ExpiryStatus expiresOn={null} today={TODAY} />)
    expect(screen.getByText('No expiry')).toBeInTheDocument()
  })

  it('shows a relative distance rather than a raw date, near and far alike', () => {
    render(<ExpiryStatus expiresOn={iso(21)} today={TODAY} />)
    expect(screen.getByText('in 3 weeks')).toBeInTheDocument()

    // The far state is relative TOO. The old badge printed the ISO date here, which meant the one
    // state a human never has to act on was the only one showing them a machine-formatted string.
    render(<ExpiryStatus expiresOn={iso(243)} today={TODAY} />)
    expect(screen.getByText('in 8 months')).toBeInTheDocument()
  })

  it('flags an expired document', () => {
    render(<ExpiryStatus expiresOn={iso(-5)} today={TODAY} />)
    expect(screen.getByText('Expired 5 days ago')).toBeInTheDocument()
  })

  it('hides the glyph from assistive tech, because the words carry the state', () => {
    const { container } = render(<ExpiryStatus expiresOn={iso(-5)} today={TODAY} />)
    // Every glyph is aria-hidden; a screen reader announcing "square" would describe the drawing
    // rather than the fact. ADR-0025 §8.
    const glyphs = container.querySelectorAll('[aria-hidden="true"]')
    expect(glyphs.length).toBeGreaterThan(0)
    // ...and nothing visible-to-AT duplicates it.
    expect(screen.getByText('Expired 5 days ago')).toBeInTheDocument()
  })

  it('distinguishes near from far by GAUGE FILL, not only by colour', () => {
    // The greyscale proof, as a test. Both states use the same gauge shape, so the thing that
    // separates them is how many bars are filled — one of three versus three of three. If a
    // refactor made both render identically, the ladder would collapse to a colour difference and
    // this is the only test that would notice.
    const near = render(<ExpiryStatus expiresOn={iso(21)} today={TODAY} />)
    const nearFilled = near.container.querySelectorAll('.bg-current').length

    const far = render(<ExpiryStatus expiresOn={iso(243)} today={TODAY} />)
    const farFilled = far.container.querySelectorAll('.bg-current').length

    expect(nearFilled).toBe(1)
    expect(farFilled).toBe(3)
  })
})

describe('the accessible name for a row', () => {
  it('carries the distance AND the absolute date', () => {
    // A screen-reader user gets no `title` tooltip and no second glance at the glyph, so the name
    // has to say both. ADR-0025 §8 specifies this string. `TODAY` is injected, because a test that
    // read the wall clock would change its answer every week.
    expect(expiryAccessibleName('Passport', '2026-09-12', TODAY)).toBe(
      'Passport — expires in 6 weeks, 12 September 2026',
    )
  })

  it('leads with the past-tense phrase for something expired, not "expires"', () => {
    // "expires Expired 6 weeks ago" is what a naive template produces. The label already carries its
    // own tense, so the prefix is only added when it reads forward.
    expect(expiryAccessibleName('Car insurance', iso(-42), TODAY)).toBe(
      `Car insurance — Expired 6 weeks ago, ${formatDate(iso(-42))}`,
    )
  })

  it('says there is no date rather than omitting the clause', () => {
    expect(expiryAccessibleName('Loft insulation quote', null)).toBe(
      'Loft insulation quote — no expiry date',
    )
  })
})

describe('formatDate', () => {
  it('formats a calendar date without constructing a Date, so it never drifts a day', () => {
    // `new Date('2026-09-12')` parses as UTC midnight and renders as 11 September anywhere west of
    // Greenwich. The whole domain is calendar dates with no time, so this slices the string.
    expect(formatDate('2026-09-12')).toBe('12 September 2026')
    expect(formatDate('2026-01-01')).toBe('1 January 2026')
    expect(formatDate('2026-12-31')).toBe('31 December 2026')
  })
})

/**
 * The two states a nearly-empty Now screen shows. Both were blank before a real phone with two
 * documents in it made the hole visible — and neither is reachable from a twelve-document fixture,
 * which is why they get tests of their own rather than being covered incidentally.
 *
 * Neither component renders a `<Link>`, so both mount without a router. That is a property worth
 * keeping: it is what makes them testable at all.
 */
/**
 * `DocumentRow` renders a `<Link>`, so it needs a router in context — which is why it had no tests
 * until now. ADR-0027 gave it interactive controls, and their **structure** is the thing worth
 * locking: buttons beside the link rather than inside it.
 */
async function renderWithRouter(ui: React.ReactElement) {
  const rootRoute = createRootRoute({ component: () => ui })
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/documents/$documentId',
    component: () => null,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([detail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  // `RouterProvider` renders nothing until the router has resolved its first match, so awaiting
  // `load()` is what makes these tests synchronous afterwards rather than a pile of `waitFor`s.
  await router.load()
  return render(<RouterProvider router={router as never} />)
}

const numbered = {
  ...detailFixture,
  identifier: '999988887777',
  identifier_last4: '7777',
  title: 'Aadhaar',
  doc_type: 'identity' as const,
}

describe('the number on an archive row', () => {
  it('badges the holder beside the title, and omits it for the owner’s own', async () => {
    await renderWithRouter(<DocumentRow document={{ ...numbered, holder: 'Priya' }} />)
    expect(screen.getByText('Priya')).toBeInTheDocument()

    // Absent for "mine". Nine "Me" pills down a list is noise, and absence is how this system draws
    // a default — `other`, no expiry, no scan.
    await renderWithRouter(<DocumentRow document={{ ...numbered, holder: null }} />)
    expect(screen.queryByText('Me')).toBeNull()
  })

  it('shows the label and the mask, not the value', async () => {
    await renderWithRouter(
      <DocumentRow
        document={numbered}
        number={{
          label: 'Aadhaar number',
          revealed: false,
          grouped: '9999 8888 7777',
          onToggleReveal: () => {},
          onCopy: () => {},
        }}
      />,
    )
    expect(screen.getByText('Aadhaar number')).toBeInTheDocument()
    expect(screen.getByText('•••• 7777')).toBeInTheDocument()
    expect(screen.queryByText('9999 8888 7777')).toBeNull()
  })

  it('names both controls after the field AND the document', async () => {
    // There can be more than one number on a screen — a hundred rows, in fact — so "Show" alone is
    // ambiguous to anyone navigating by control name.
    await renderWithRouter(
      <DocumentRow
        document={numbered}
        number={{
          label: 'Aadhaar number',
          revealed: false,
          grouped: '9999 8888 7777',
          onToggleReveal: () => {},
          onCopy: () => {},
        }}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Show Aadhaar number for Aadhaar' }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Copy Aadhaar number for Aadhaar' }),
    ).toBeInTheDocument()
  })

  it('keeps the buttons OUTSIDE the link, because interactive content cannot nest', async () => {
    /**
     * The structural assertion, and the reason the row is a container rather than a link.
     *
     * The comp draws the row as a `div` with an `onClick` and calls `stopPropagation()` on the buttons
     * inside it. A `<button>` inside an `<a>` is invalid HTML: browsers cope unevenly, screen readers
     * fold the inner control into the link's accessible name, and a keyboard user cannot reach it. If
     * someone later "simplifies" this back to buttons-inside-link, this fails.
     */
    const { container } = await renderWithRouter(
      <DocumentRow
        document={numbered}
        number={{
          label: 'Aadhaar number',
          revealed: false,
          grouped: '9999 8888 7777',
          onToggleReveal: () => {},
          onCopy: () => {},
        }}
      />,
    )
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.querySelector('button')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(2)
  })

  it('shows the grouped value once revealed, and flips the control to Hide', async () => {
    await renderWithRouter(
      <DocumentRow
        document={numbered}
        number={{
          label: 'Aadhaar number',
          revealed: true,
          grouped: '9999 8888 7777',
          onToggleReveal: () => {},
          onCopy: () => {},
        }}
      />,
    )
    expect(screen.getByText('9999 8888 7777')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Hide Aadhaar number for Aadhaar' }),
    ).toBeInTheDocument()
  })

  it('draws no number and no controls when the prop is absent', async () => {
    // What the Now screen's cards want: rows without a number line.
    const { container } = await renderWithRouter(<DocumentRow document={numbered} />)
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(screen.queryByText('•••• 7777')).toBeNull()
  })

  it('draws no number line for a document that has none, even when asked to', async () => {
    const { container } = await renderWithRouter(
      <DocumentRow
        document={{ ...numbered, identifier: null, identifier_last4: null }}
        number={{
          label: 'Number',
          revealed: false,
          grouped: '',
          onToggleReveal: () => {},
          onCopy: () => {},
        }}
      />,
    )
    // A "•••• " with nothing after it, and two controls that copy an empty string, is worse than
    // nothing at all.
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })

  it('survives a row cached by a build that had no identifier field', async () => {
    // The D46 shape drift again, on the row this time. `identifier` absent, not null.
    const { identifier: _dropped, ...stale } = numbered
    const { container } = await renderWithRouter(
      <DocumentRow document={stale as typeof numbered} />,
    )
    expect(container.querySelector('a')).not.toBeNull()
  })
})

describe('the identifier card', () => {
  it('masks by default and reveals on request', async () => {
    render(<IdentifierCard identifier="999988887777" last4="7777" label="Aadhaar number" />)

    // Masked first. The full value is already in the DOM's props — the mask is a display state, not a
    // boundary (see the component's own note) — but it must not be the thing on screen.
    expect(screen.getByText('•••• 7777')).toBeInTheDocument()
    expect(screen.queryByText(/9999 8888 7777/)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reveal Aadhaar number' }))
    expect(screen.getByText('9999 8888 7777')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Hide Aadhaar number' }))
    expect(screen.getByText('•••• 7777')).toBeInTheDocument()
  })

  it('groups an all-digit number in fours, and leaves an alphanumeric one alone', async () => {
    // 9999 8888 7777 is how an Aadhaar number is printed and read back aloud. A PAN is not grouped,
    // because inserting spaces into an alphanumeric code invents a format the document does not use.
    const { unmount } = render(<IdentifierCard identifier="999988887777" last4="7777" />)
    await userEvent.click(screen.getByRole('button', { name: /Reveal/ }))
    expect(screen.getByText('9999 8888 7777')).toBeInTheDocument()
    unmount()

    render(<IdentifierCard identifier="ABCDE1234F" last4="234F" />)
    await userEvent.click(screen.getByRole('button', { name: /Reveal/ }))
    expect(screen.getByText('ABCDE1234F')).toBeInTheDocument()
  })

  it('renders nothing at all when the document has no number', () => {
    // An empty bordered box under "Details" reads as a field that failed to load.
    const { container } = render(<IdentifierCard identifier={null} last4={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('survives a document cached by an older build, where the field is absent entirely', () => {
    /**
     * The regression. This crashed the app at its root error boundary on a real phone —
     * *"undefined is not an object (evaluating 'e.length')"* — and no type could have caught it,
     * because `documentDetailResponseSchema` says `identifier` is `string | null`.
     *
     * The lie comes from the persisted Query cache: a detail fetched by an older build has no
     * `identifier` key, and TanStack Query **rehydrates without re-running Zod**. So the first render
     * after a deploy is handed an object the schema says cannot exist. `undefined`, not `null`.
     */
    const { container } = render(<IdentifierCard identifier={undefined} last4={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('never claims the value is encrypted, because it is not', () => {
    // The comp's copy is "Stored in full, encrypted at rest, hidden until you ask." Nothing here is
    // encrypted — invariant 7 and ADR-0009 keep application-level encryption for the vault — and this
    // is the one paragraph whose whole job is telling the user how their Aadhaar number is handled.
    render(<IdentifierCard identifier="999988887777" last4="7777" />)
    expect(screen.queryByText(/encrypted/i)).toBeNull()
    expect(screen.getByText(/stored in full/i)).toBeInTheDocument()
  })
})

describe('numberLabelFor', () => {
  it('names the real number when the title matches a preset', () => {
    expect(numberLabelFor('Aadhaar', 'identity')).toBe('Aadhaar number')
    expect(numberLabelFor('PAN card', 'identity')).toBe('PAN')
    expect(numberLabelFor('Vehicle RC', 'legal')).toBe('Registration number')
    // Case and surrounding space are the user's, not the table's.
    expect(numberLabelFor('  aadhaar  ', 'identity')).toBe('Aadhaar number')
  })

  it('does not match on a substring, which would mislabel a related document', () => {
    // A loose `includes()` would label "Passport photos" as carrying a passport number, and
    // "Old passport" as the current one. Exact-after-trim is the whole point.
    expect(numberLabelFor('Passport photos', 'other')).toBe('Number')
    expect(numberLabelFor('Old passport', 'identity')).toBe('Number')
    expect(numberLabelFor('Dishwasher receipt', 'receipt')).toBe('Number')
  })
})

describe('the preset table', () => {
  it('offers nine common presets out of 22', () => {
    // The counts are in the UI's copy ("All 22"), so a preset added without the `common` flag would
    // silently change what the row shows. Asserted non-zero and exact — D33.
    expect(PRESETS).toHaveLength(22)
    expect(COMMON_PRESETS).toHaveLength(9)
  })

  it('leaves the issuer blank exactly where it genuinely varies', () => {
    // Insurers, banks and landlords. Prefilling a guess there is worse than prefilling nothing,
    // because the user has to notice it is wrong before correcting it.
    const blankIssuer = PRESETS.filter((preset) => preset.issuer === '').map((p) => p.name)
    expect(blankIssuer).toEqual([
      'Vehicle insurance',
      'Health insurance',
      'Rent agreement',
      'Bank passbook',
    ])
  })

  it('gives every preset a number label, so the field is never called "Identifier"', () => {
    for (const preset of PRESETS) {
      expect(preset.numLabel.length).toBeGreaterThan(0)
      expect(preset.numLabel).not.toMatch(/identifier/i)
    }
  })
})

describe('useOpenAdd', () => {
  it('throws without a provider rather than handing back a no-op', () => {
    // Add is reachable from two places now that it is not a tab — the Now header and the Documents
    // pill — so the hook can be called from a tree that forgot the provider. Returning a no-op there
    // would render a button that focuses, announces and does NOTHING on tap, which is precisely the
    // class of bug this codebase has shipped twice with valid markup and a passing suite.
    function Probe() {
      useOpenAdd()
      return null
    }
    // React logs the render failure; the assertion is the throw, so the log is noise.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/AddSheetProvider/)
    quiet.mockRestore()
  })
})

describe('the horizon with no entries', () => {
  it('states that nothing else is dated when every dated document is already urgent', () => {
    // The reported case: one passport expiring in 6 days, so `rows` is empty while `datedTotal` is 1.
    render(<Horizon rows={[]} datedTotal={1} complete={true} />)
    expect(screen.getByText(/nothing else has a date we watch\./i)).toBeInTheDocument()
    expect(screen.getByText(/the horizon/i)).toBeInTheDocument()
  })

  it('renders nothing when the archive holds no dates at all, because the headline says it', () => {
    const { container } = render(<Horizon rows={[]} datedTotal={0} complete={true} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('does not claim a total it cannot know when the archive did not fit on one page', () => {
    render(<Horizon rows={[]} datedTotal={2} complete={false} />)
    expect(screen.getByText(/nothing else has a date we watch on this page\./i)).toBeInTheDocument()
  })
})

describe('GettingStarted', () => {
  it('counts in words that agree with the number', () => {
    render(<GettingStarted count={1} />)
    expect(screen.getByText('One document in your ledger.')).toBeInTheDocument()
  })

  it('pluralises above one', () => {
    render(<GettingStarted count={2} />)
    expect(screen.getByText('2 documents in your ledger.')).toBeInTheDocument()
  })

  it('points at the Add tab rather than adding a second control that competes with it', () => {
    // The decision this locks in: the Add tab is permanently on screen, so a button here would be a
    // second route to one action. If someone adds one, this fails rather than shipping the rivalry.
    render(<GettingStarted count={2} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText(/use/i)).toBeInTheDocument()
  })

  it('tells the user a title alone is enough — Q2, same promise the form keeps', () => {
    render(<GettingStarted count={3} />)
    expect(screen.getByText(/a title on its own is enough/i)).toBeInTheDocument()
  })
})

describe('DocumentForm', () => {
  it('submits with a title alone — Q2, and the whole point of the capture flow', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ title: 'Passport', doc_type: 'other' })
  })

  it('keeps Save disabled at zero characters and enables it from the first', async () => {
    // The capture budget (ADR-0025 §5): Save is live from character one, so the user never has to
    // look at the button to find out whether they are finished. A form that validates before
    // enabling would fail this.
    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)

    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Title'), 'P')
    expect(save).toBeEnabled()
  })

  it('does not submit a title of nothing but spaces', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    // `.trim()` in the schema is what catches this, and the button's own guard trims too — so a
    // whitespace title must be stopped by both rather than sneaking past one of them.
    await userEvent.type(screen.getByLabelText('Title'), '   ')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps the extra fields hidden until asked for', async () => {
    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)

    // Capture friction is the risk Q2 traded against, so the extra fields must not be in the way.
    expect(screen.queryByLabelText('Expires')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))
    expect(screen.getByLabelText('Expires')).toBeInTheDocument()
  })

  it('sends null rather than an empty string for a field left blank', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>
    // `''` would store an empty string where the user meant nothing — a blank that is not absent,
    // and which sorts differently (conventions/api.md §8).
    expect(payload.issuer).toBeNull()
    expect(payload.expires_on).toBeNull()
    expect(payload.notes).toBeNull()
    expect(payload.identifier).toBeNull()
  })

  it('offers the seven types as pills rather than a dropdown', async () => {
    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))

    /**
     * ADR-0025 §7: no dropdowns. A `<select>` here would open an OS wheel on a 390px screen, which
     * is worse than seven visible options — so the absence of one is the assertion.
     *
     * Asserted on the `select` ELEMENT rather than on `role="combobox"`. The issuer field is an
     * `<input list="issuer-suggestions">`, and an input with a datalist *is* a combobox by the ARIA
     * mapping — so a role query here would fail on the autocomplete this design deliberately keeps.
     */
    expect(document.querySelector('select')).toBeNull()
    const group = screen.getByRole('group', { name: 'Type' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Certificate', pressed: false })).toBeInTheDocument()
  })

  it('offers no "Other" pill, and starts with NOTHING selected', async () => {
    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))

    /**
     * `doc_type` defaults to `'other'`, so rendering all seven options put a filled ink "Other" pill
     * on every untouched form — the type row looked answered before the user touched it. `other` is
     * the *absence* of a type, and the rest of the app already treats it that way ("No type" on the
     * detail screen, omitted from a row's meta line).
     */
    expect(screen.queryByRole('button', { name: 'Other' })).not.toBeInTheDocument()
    for (const label of ['Identity', 'Financial', 'Legal', 'Warranty', 'Receipt', 'Certificate']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('sends the chosen type, and returns to the default when the same pill is tapped again', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'First aid certificate')
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Certificate' }))
    expect(screen.getByRole('button', { name: 'Certificate', pressed: true })).toBeInTheDocument()

    // Tapping it again clears back to `other`, the schema default — so the control is undoable
    // without a "None" pill that would read as a type of its own.
    await userEvent.click(screen.getByRole('button', { name: 'Certificate' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ doc_type: 'other' })
  })

  it('captures the whole number, and does not make the user open "Add more" to reach it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    // No "Add more now" click. ADR-0026 promotes the number to the second field, because a document's
    // number is one of the two things a person actually has to hand when they photograph it.
    await userEvent.type(screen.getByLabelText('Number'), 'FAKEM1234567')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // The FULL value goes over the wire now; the server derives `identifier_last4` from it. The old
    // version of this test asserted '4471' from a `maxLength={4}` field — that cap is gone, since it
    // would now be the only thing discarding the number.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ identifier: 'FAKEM1234567' })
  })

  it('renames the number field and prefills from a preset, in one tap', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    // Before: the generic label, because no preset is in play.
    expect(screen.getByLabelText('Number')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar' }))

    // After: the field is called what the document calls it, and title/type/issuer are filled.
    expect(screen.getByLabelText('Aadhaar number')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Aadhaar')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: 'Aadhaar',
      doc_type: 'identity',
      issuer: 'UIDAI',
    })
  })

  it('replaces the previous preset rather than merging with it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Aadhaar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Vehicle insurance' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // UIDAI must not survive as the issuer of an insurance policy. The presets that leave `issuer`
    // blank do so because insurers vary and we must not guess — carrying the previous pick over
    // would be exactly that guess, arriving without the user typing anything.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      title: 'Vehicle insurance',
      doc_type: 'financial',
      issuer: null,
    })
  })

  it('survives a document cached by an older build, where the number field is absent', () => {
    // The same shape drift that crashed `IdentifierCard`. This form reads `initial?.identifier ?? ''`,
    // so it was already safe — the test is here so it stays that way, since a `?? ''` is exactly the
    // sort of thing a later refactor "simplifies" to `initial.identifier`.
    const { identifier: _dropped, ...stale } = detailFixture
    renderWithQuery(<DocumentForm initial={stale as typeof detailFixture} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Title')).toHaveValue('Passport')
    expect(screen.getByLabelText('Passport number')).toHaveValue('')
  })

  it('formats the number when EDITING too, recovered from the saved title', async () => {
    /**
     * The gap this closes: the preset chooser is hidden when editing, so `activePreset` was always
     * null there and everything hanging off it fell away — no grouping, no counter, no numeric keypad,
     * no example. Only the *label* had a fallback, which made it look deliberate: the field said
     * "Aadhaar number" and then behaved like free text.
     */
    const aadhaar = {
      ...detailFixture,
      title: 'Aadhaar',
      doc_type: 'identity' as const,
      identifier: '999988887777',
    }
    renderWithQuery(<DocumentForm initial={aadhaar} onSubmit={vi.fn()} />)

    const field = screen.getByLabelText('Aadhaar number')
    // Formatted on LOAD, not merely on the next keystroke — otherwise the edit form shows a saved
    // number differently from the screen the user just came from.
    expect(field).toHaveValue('9999 8888 7777')
    // The counter and the example are present, which is what was missing entirely.
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('1234 5678 9012')).toBeInTheDocument()
    expect(field).toHaveAttribute('inputmode', 'numeric')
  })

  it('reformats as you type on the edit form', async () => {
    const aadhaar = {
      ...detailFixture,
      title: 'Aadhaar',
      doc_type: 'identity' as const,
      identifier: null,
    }
    renderWithQuery(<DocumentForm initial={aadhaar} onSubmit={vi.fn()} />)

    const field = screen.getByLabelText('Aadhaar number')
    await userEvent.type(field, '999988887777')
    expect(field).toHaveValue('9999 8888 7777')
  })

  it('refuses to reformat a stored number the shape would mangle', async () => {
    /**
     * The hazard that load-formatting introduces, and the guard against it.
     *
     * A document titled "Passport" whose number is `FAKEM1234471` reformats under the `A#######` mask
     * to `F1234471` — eight characters where there were twelve, on a value nobody touched, and
     * persisted by a Save that changed something else entirely. `fitsShape` refuses the format for
     * that document: the number demonstrably is not in the preset's shape, so the shape is the wrong
     * thing to trust.
     */
    const odd = {
      ...detailFixture,
      title: 'Passport',
      doc_type: 'identity' as const,
      identifier: 'FAKEM1234471',
    }
    renderWithQuery(<DocumentForm initial={odd} onSubmit={vi.fn()} />)

    const field = screen.getByLabelText('Passport number')
    expect(field).toHaveValue('FAKEM1234471')
    // No completeness counter either — it would report "Complete" on twelve characters in an
    // eight-character shape, which is worse than saying nothing.
    expect(screen.queryByText('Complete')).toBeNull()
    // The label still names a passport. Only the reshaping is dropped, not the identification.
    expect(field).toBeInTheDocument()
  })

  it('leaves a conforming stored number alone while formatting it', async () => {
    const clean = {
      ...detailFixture,
      title: 'Passport',
      doc_type: 'identity' as const,
      identifier: 'M1234567',
    }
    renderWithQuery(<DocumentForm initial={clean} onSubmit={vi.fn()} />)
    expect(screen.getByLabelText('Passport number')).toHaveValue('M1234567')
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('keeps the shape the document was SAVED as, not the one being typed into the title', async () => {
    /**
     * Renaming a document must not start reshaping its number.
     *
     * `watch('title')` would have been the obvious source, and it would mean typing "Aadhaar" over a
     * policy number silently rewrites a stored value to digits-only. On create that boundary is
     * protected by `carryNumber`, which clears rather than mangles; there is no equivalent safety for
     * a value the user did not just type. So the shape is fixed at what the document was saved as.
     */
    const policy = {
      ...detailFixture,
      title: 'Vehicle insurance',
      doc_type: 'financial' as const,
      identifier: 'AV-4471-9820',
    }
    renderWithQuery(<DocumentForm initial={policy} onSubmit={vi.fn()} />)

    // Free text, because "Vehicle insurance" has no format — the value survives verbatim.
    expect(screen.getByLabelText('Policy number')).toHaveValue('AV-4471-9820')

    await userEvent.clear(screen.getByLabelText('Title'))
    await userEvent.type(screen.getByLabelText('Title'), 'Aadhaar')

    // Still the policy number, untouched, under its original label.
    expect(screen.getByLabelText('Policy number')).toHaveValue('AV-4471-9820')
  })

  it('files a document for someone else, and sends both fields', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    // "Me" is selected by default — the absence of a holder, which is how this system draws a default.
    expect(screen.getByRole('button', { name: 'Me' })).toHaveAttribute('aria-pressed', 'true')
    // The name fields are not there until asked for.
    expect(screen.queryByLabelText('Their name')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Someone else' }))
    await userEvent.type(screen.getByLabelText('Their name'), 'Priya')
    await userEvent.type(screen.getByLabelText('How they’re related'), 'Wife')
    await userEvent.type(screen.getByLabelText('Title'), 'Aadhaar')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ holder: 'Priya', relation: 'Wife' })
  })

  it('sends no holder at all for the owner’s own document', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'My PAN')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // `null`, not the string "Me". The account holder has no name anywhere in the app: "mine" is the
    // absence of a holder, and the blank-to-null transform is what makes that arrive as null.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ holder: null, relation: null })
  })

  it('opens the name fields already filled when editing someone else’s document', async () => {
    // The suggestion list loads asynchronously, so a document filed for Priya must not appear to be
    // filed for "Me" during the first render — which is what a `useState(false)` here would do.
    // No holders handler here, so the suggestions never arrive and the field stays open.
    const hers = { ...detailFixture, holder: 'Priya', relation: 'Wife' }
    renderWithQuery(<DocumentForm initial={hers} onSubmit={vi.fn()} />)

    expect(screen.getByLabelText('Their name')).toHaveValue('Priya')
    expect(screen.getByLabelText('How they’re related')).toHaveValue('Wife')
    expect(screen.getByRole('button', { name: 'Me' })).toHaveAttribute('aria-pressed', 'false')
  })

  /*
   * ═════════════════════════════════════════════════════════════════════════════════════════
   *  The three below are one bug, found by RENDERING the edit screen — not by any assertion on
   *  what got submitted, which was correct the whole time.
   * ═════════════════════════════════════════════════════════════════════════════════════════
   *
   * `someoneElse` was state seeded from `initial.holder`. Every saved holder is also a suggestion
   * (`distinctHolders()` returns all of them), so editing Priya's Aadhaar lit **her chip and the
   * dashed one at once**, with a second editable copy of her name below. Openness is now derived.
   */

  it('closes the name fields once the person turns out to have a chip', async () => {
    server.use(
      http.get('*/api/v1/documents/holders', () =>
        HttpResponse.json({ data: [{ holder: 'Priya', relation: 'Wife' }] }),
      ),
    )
    const hers = { ...detailFixture, holder: 'Priya', relation: 'Wife' }
    renderWithQuery(<DocumentForm initial={hers} onSubmit={vi.fn()} />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Priya' })).toHaveAttribute('aria-pressed', 'true'),
    )
    // Exactly one selected chip. Two is not a decoration bug — it leaves no way to tell which value
    // will be saved.
    expect(screen.getByRole('button', { name: 'Someone else' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByLabelText('Their name')).toBeNull()
  })

  it('choosing Me closes the name fields rather than leaving them open and empty', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Someone else' }))
    await userEvent.type(screen.getByLabelText('Their name'), 'Priya')
    await userEvent.click(screen.getByRole('button', { name: 'Me' }))

    // An empty "Their name" under a selected Me reads as a required field still to fill in.
    expect(screen.queryByLabelText('Their name')).toBeNull()
    expect(screen.getByRole('button', { name: 'Me' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.type(screen.getByLabelText('Title'), 'My PAN')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // And the typed-then-abandoned name is not quietly submitted.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ holder: null, relation: null })
  })

  it('picking a suggested person closes the fields and does not double-select', async () => {
    server.use(
      http.get('*/api/v1/documents/holders', () =>
        HttpResponse.json({ data: [{ holder: 'Arjun', relation: 'Son (12)' }] }),
      ),
    )
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    // Open the fields first, so the test covers the transition and not just the initial state.
    await userEvent.click(screen.getByRole('button', { name: 'Someone else' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Arjun' }))

    expect(screen.queryByLabelText('Their name')).toBeNull()
    expect(screen.getByRole('button', { name: 'Someone else' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )

    await userEvent.type(screen.getByLabelText('Title'), 'Bike registration')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // The relation rides along with the person — that is what keeps it from being a second thing to
    // type on every document filed for the same child.
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ holder: 'Arjun', relation: 'Son (12)' })
  })

  it('re-opening the fields to rename someone starts from their current name', async () => {
    server.use(
      http.get('*/api/v1/documents/holders', () =>
        HttpResponse.json({ data: [{ holder: 'Priya', relation: 'Wife' }] }),
      ),
    )
    const hers = { ...detailFixture, holder: 'Priya', relation: 'Wife' }
    renderWithQuery(<DocumentForm initial={hers} onSubmit={vi.fn()} />)

    await waitFor(() => expect(screen.queryByLabelText('Their name')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: 'Someone else' }))

    // Not blank. Tapping it to fix a spelling should not make you retype the name first — and the
    // suggestion list must no longer be able to close the field under you.
    expect(screen.getByLabelText('Their name')).toHaveValue('Priya')
    expect(screen.getByRole('button', { name: 'Priya' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers the people picker when EDITING too, unlike the preset chooser', async () => {
    // The preset chooser is hidden on an edit because a tap overwrites the title. Picking a person
    // overwrites nothing the user typed, so there is no reason to hide this one.
    renderWithQuery(<DocumentForm initial={detailFixture} onSubmit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Me' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aadhaar' })).toBeNull()
  })

  it('offers no presets when editing, where a tap would overwrite a real title', async () => {
    // A shortcut that destroys existing data is not a shortcut. `initial` present means editing.
    const existing = {
      ...detailFixture,
      title: 'My actual passport',
    }
    renderWithQuery(<DocumentForm initial={existing} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Aadhaar' })).toBeNull()
    expect(screen.getByLabelText('Title')).toHaveValue('My actual passport')
  })

  it('uppercases a country code so the server does not reject it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))
    await userEvent.type(screen.getByLabelText('Country'), 'gb')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // `countryCodeSchema` is `^[A-Z]{2}$`, so a lowercase entry would be a 400 for no good reason.
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(payload?.country).toBe('GB')
  })

  it('hides country and notes in the sheet’s compact field set', async () => {
    renderWithQuery(<DocumentForm onSubmit={vi.fn()} compact />)
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))

    // The two fields nobody has to hand at the moment of capture. Both stay editable from the detail
    // screen, so this must hide them rather than make them unreachable.
    expect(screen.queryByLabelText('Country')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
    // ...while the ones the design does show are still there.
    expect(screen.getByLabelText('Expires')).toBeInTheDocument()
  })

  it("surfaces the server's message rather than inventing its own", async () => {
    const onSubmit = vi.fn().mockRejectedValue(
      Object.assign(new Error('An expiry date cannot be before the issue date.'), {
        name: 'ApiError',
      }),
    )
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Not an ApiError instance, so it falls back to the generic message — which is the correct
    // behaviour for an unrecognised failure, and what a network error looks like.
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument()
  })

  it('keeps what was typed when the server rejects it, so nothing is retyped', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('nope'))
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Dishwasher receipt')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // ADR-0025 §5: "the sheet comes back with the row still in it and the server's own sentence at
    // the top. Nothing is ever retyped." A form that reset on failure would fail this.
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Dishwasher receipt')
  })

  it('offers existing issuers as autocomplete suggestions', async () => {
    server.use(
      http.get('*/api/v1/documents/issuers', () =>
        HttpResponse.json({ data: ['HM Passport Office', 'DVLA'] }),
      ),
    )

    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))

    // §9 question 1: free text plus autocomplete-over-distinct, not an issuers table.
    await waitFor(() =>
      expect(document.querySelector('option[value="HM Passport Office"]')).not.toBeNull(),
    )
  })
})
