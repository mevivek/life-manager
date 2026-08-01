import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw'
import { SignInForm } from './SignInForm'

/**
 * Sign in — the password form, and the capability gate in front of it (ADR-0035).
 *
 * `providers()` is deliberately NOT a default handler in `test/msw.ts`: every test here states which
 * of the four server answers it is about, because "which screen does this deployment get" is the
 * whole subject and a default would make three of the four invisible.
 */

/**
 * MSW does not answer `/api/v1/auth/providers` until a test says how. `never` is a real state, not a
 * trick — it is what an unreachable API looks like from the browser before anything times out.
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
  // The real client retries a 500 twice, which is right in production and is seconds of skeleton in a
  // test asserting what the FAILED probe falls back to.
  client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('SignInForm capability gate', () => {
  it('is Google-only — no email or password field — when the server has Google', async () => {
    providers({ google: true })
    renderIn(<SignInForm onSuccess={vi.fn()} />)

    expect(await screen.findByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    // The assertion that matters is the ABSENCE. A screen that showed both would be the comp plus the
    // old form, which is neither of the two states ADR-0035 defines.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(
      screen.getByText(/one account, no password to forget/i, { exact: false }),
    ).toBeInTheDocument()
  })

  it('renders the password form when the server says it has no Google', async () => {
    providers({ google: false })
    renderIn(<SignInForm onSuccess={vi.fn()} />)

    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    // And no dead button: Google is not configured, so offering it would be a control that cannot work.
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
    expect(screen.getByText(/isn’t configured on this server/i)).toBeInTheDocument()
  })

  it('renders neither the form nor the button while the capability is unknown', async () => {
    providers('never')
    renderIn(<SignInForm onSuccess={vi.fn()} />)

    expect(
      await screen.findByRole('status', { name: 'Checking how you can sign in' }),
    ).toBeVisible()
    // Both halves, because guessing EITHER way is the bug: a form the user starts typing into and
    // then loses, or a button that is about to be replaced.
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
  })

  /**
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *  THE ANTI-LOCKOUT TEST. If this goes red, a broken capability probe locks the user out.
   * ═══════════════════════════════════════════════════════════════════════════════════════
   *
   * ADR-0035 exists to stop a configuration problem from becoming an outage. A client that showed
   * its skeleton forever — or its Google button — because the probe failed would reintroduce exactly
   * that outage from the other side: offline, or with the API down, a Google redirect cannot work
   * either, so the password form is the only thing that might. `useAuthScreen` checks `isError`
   * BEFORE it checks for missing data, and this is what pins that order.
   */
  it('falls back to the password form when the capability request FAILS', async () => {
    providers('error')
    renderIn(<SignInForm onSuccess={vi.fn()} />)

    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()

    // And it must not claim a diagnosis it does not have. "Not configured on this server" is a fact
    // the server states; a failed request states nothing.
    expect(screen.queryByText(/isn’t configured on this server/i)).not.toBeInTheDocument()
  })
})

describe('SignInForm password form', () => {
  it('shows a validation message without calling the API when the email is malformed', async () => {
    providers({ google: false })
    const onSuccess = vi.fn()
    renderIn(<SignInForm onSuccess={onSuccess} />)

    await userEvent.type(await screen.findByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'not-a-real-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    // The message comes from signInSchema in packages/shared, not from a string in this app —
    // which is what makes the client and server agree (ADR-0004).
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('calls onSuccess after a successful sign-in', async () => {
    providers({ google: false })
    const onSuccess = vi.fn()
    renderIn(<SignInForm onSuccess={onSuccess} />)

    await userEvent.type(await screen.findByLabelText('Email'), 'test@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'not-a-real-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce()
    })
  })

  it('surfaces a failed sign-in instead of silently doing nothing', async () => {
    // The failure mode worth a test: a form that swallows a 401 looks identical to a hung
    // network, and the user just keeps pressing the button.
    providers({ google: false })
    server.use(
      http.post('*/api/v1/auth/sign-in/email', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    )
    const onSuccess = vi.fn()
    renderIn(<SignInForm onSuccess={onSuccess} />)

    await userEvent.type(await screen.findByLabelText('Email'), 'test@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'not-the-right-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That email and password combination did not work.')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not distinguish a wrong password from a missing account', async () => {
    // Account enumeration. The API is careful about this; the form must not undo it by echoing
    // whatever message came back.
    providers({ google: false })
    server.use(
      http.post('*/api/v1/auth/sign-in/email', () =>
        HttpResponse.json({ message: 'User not found' }, { status: 404 }),
      ),
    )
    renderIn(<SignInForm onSuccess={vi.fn()} />)

    await userEvent.type(await screen.findByLabelText('Email'), 'nobody@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'not-a-real-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That email and password combination did not work.')
    expect(alert).not.toHaveTextContent('not found')
  })
})
