import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { SignUpForm } from './SignUpForm'

/**
 * Sign up gets its own copy of the four capability states rather than trusting that it shares
 * `SignInForm`'s implementation — it does today, and the failure being guarded against is the day
 * someone edits one screen and not the other. ADR-0035 names that: two screens that can disagree.
 */

function providers(answer: { google: boolean } | 'error' | 'never'): void {
  server.use(
    http.get('*/api/v1/auth/providers', async () => {
      // `Promise<never>`, so the narrowing below is control-flow analysis rather than a cast: a
      // promise that never settles is what an unreachable API looks like before anything times out.
      if (answer === 'never') return new Promise<never>(() => {})
      if (answer === 'error') return HttpResponse.json({ title: 'boom' }, { status: 500 })
      return HttpResponse.json({ google: answer.google, password: true })
    }),
  )
}

function renderIn(ui: ReactElement) {
  const client = createQueryClient()
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SignUpForm capability gate', () => {
  it('is Google-only — no name, email or password field — when the server has Google', async () => {
    providers({ google: true })
    renderIn(<SignUpForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('renders the password form when the server says it has no Google', async () => {
    providers({ google: false })
    renderIn(<SignUpForm onSuccess={vi.fn()} />)

    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByText(/isn’t configured on this server/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })

  it('renders neither the form nor the button while the capability is unknown', async () => {
    providers('never')
    renderIn(<SignUpForm onSuccess={vi.fn()} />)

    expect(
      await screen.findByRole('status', { name: 'Checking how you can sign in' }),
    ).toBeVisible()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })

  /** The anti-lockout guarantee, for the second screen. See the long note in `SignInForm.test.tsx`. */
  it('falls back to the password form when the capability request FAILS', async () => {
    providers('error')
    renderIn(<SignUpForm onSuccess={vi.fn()} />)

    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.queryByText(/isn’t configured on this server/i)).not.toBeInTheDocument()
  })
})
