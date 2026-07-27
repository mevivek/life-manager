import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '@/test/msw'
import { SignInForm } from './SignInForm'

describe('SignInForm', () => {
  it('shows a validation message without calling the API when the email is malformed', async () => {
    const onSuccess = vi.fn()
    render(<SignInForm onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('Email'), 'not-an-email')
    await userEvent.type(screen.getByLabelText('Password'), 'not-a-real-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    // The message comes from signInSchema in packages/shared, not from a string in this app —
    // which is what makes the client and server agree (ADR-0004).
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('calls onSuccess after a successful sign-in', async () => {
    const onSuccess = vi.fn()
    render(<SignInForm onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('Email'), 'test@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'not-a-real-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce()
    })
  })

  it('surfaces a failed sign-in instead of silently doing nothing', async () => {
    // The failure mode worth a test: a form that swallows a 401 looks identical to a hung
    // network, and the user just keeps pressing the button.
    server.use(
      http.post('*/api/v1/auth/sign-in/email', () =>
        HttpResponse.json({ message: 'Invalid email or password' }, { status: 401 }),
      ),
    )
    const onSuccess = vi.fn()
    render(<SignInForm onSuccess={onSuccess} />)

    await userEvent.type(screen.getByLabelText('Email'), 'test@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'not-the-right-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That email and password combination did not work.')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not distinguish a wrong password from a missing account', async () => {
    // Account enumeration. The API is careful about this; the form must not undo it by echoing
    // whatever message came back.
    server.use(
      http.post('*/api/v1/auth/sign-in/email', () =>
        HttpResponse.json({ message: 'User not found' }, { status: 404 }),
      ),
    )
    render(<SignInForm onSuccess={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'not-a-real-password')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That email and password combination did not work.')
    expect(alert).not.toHaveTextContent('not found')
  })
})
