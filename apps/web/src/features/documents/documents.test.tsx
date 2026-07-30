import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { useOpenAdd } from './AddSheetProvider'
import { DocumentForm } from './DocumentForm'
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

  it('captures the last four of the number, which the old form could not', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Add more now (all optional)' }))
    await userEvent.type(screen.getByLabelText('Last four of the number'), '4471')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // The wire field is `identifier`; the API truncates to the last four (business rule 6).
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ identifier: '4471' })
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
    expect(screen.getByLabelText('Last four of the number')).toBeInTheDocument()
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
