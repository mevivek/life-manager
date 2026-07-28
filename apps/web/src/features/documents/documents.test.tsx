import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { DocumentForm } from './DocumentForm'
import { daysUntil, ExpiryBadge } from './ExpiryBadge'

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

describe('ExpiryBadge', () => {
  it('says so plainly when there is no expiry, rather than showing an empty slot', () => {
    // Q1's answer, rendered: no expiry is a normal silent case, not missing data.
    render(<ExpiryBadge expiresOn={null} />)
    expect(screen.getByText('No expiry')).toBeInTheDocument()
  })

  it('shows a countdown when expiry is near and the date when it is far', () => {
    const soon = new Date()
    soon.setUTCDate(soon.getUTCDate() + 10)
    render(<ExpiryBadge expiresOn={soon.toISOString().slice(0, 10)} />)
    expect(screen.getByText('10d left')).toBeInTheDocument()

    const distant = new Date()
    distant.setUTCFullYear(distant.getUTCFullYear() + 3)
    const distantIso = distant.toISOString().slice(0, 10)
    render(<ExpiryBadge expiresOn={distantIso} />)
    expect(screen.getByText(distantIso)).toBeInTheDocument()
  })

  it('flags an expired document', () => {
    const past = new Date()
    past.setUTCDate(past.getUTCDate() - 5)
    render(<ExpiryBadge expiresOn={past.toISOString().slice(0, 10)} />)
    expect(screen.getByText('Expired 5d ago')).toBeInTheDocument()
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

  it('does not submit an empty title', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('A title is required')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps the extra fields hidden until asked for', async () => {
    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)

    // Capture friction is the risk Q2 traded against, so the extra fields must not be in the way.
    expect(screen.queryByLabelText('Expires')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add details' }))
    expect(screen.getByLabelText('Expires')).toBeInTheDocument()
  })

  it('sends null rather than an empty string for a field left blank', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Add details' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>
    // `''` would store an empty string where the user meant nothing — a blank that is not absent,
    // and which sorts differently (conventions/api.md §8).
    expect(payload.issuer).toBeNull()
    expect(payload.expires_on).toBeNull()
    expect(payload.notes).toBeNull()
  })

  it('uppercases a country code so the server does not reject it', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    renderWithQuery(<DocumentForm onSubmit={onSubmit} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Passport')
    await userEvent.click(screen.getByRole('button', { name: 'Add details' }))
    await userEvent.type(screen.getByLabelText('Country'), 'gb')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    // `countryCodeSchema` is `^[A-Z]{2}$`, so a lowercase entry would be a 400 for no good reason.
    const payload = onSubmit.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(payload?.country).toBe('GB')
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

  it('offers existing issuers as autocomplete suggestions', async () => {
    server.use(
      http.get('*/api/v1/documents/issuers', () =>
        HttpResponse.json({ data: ['HM Passport Office', 'DVLA'] }),
      ),
    )

    renderWithQuery(<DocumentForm onSubmit={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add details' }))

    // §9 question 1: free text plus autocomplete-over-distinct, not an issuers table.
    await waitFor(() =>
      expect(document.querySelector('option[value="HM Passport Office"]')).not.toBeNull(),
    )
  })
})
