import { zodResolver } from '@hookform/resolvers/zod'
import { type SignInInput, signInSchema } from '@life-manager/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn } from '@/lib/auth-client'
import { GoogleButton } from './GoogleButton'

/**
 * Sign in. ADR-0025 draws this screen, and two things about its ORDER are deliberate.
 *
 * **Email and password come first, Google second.** The comp puts the ink primary immediately under
 * the fields and "Continue with Google" beneath it as a secondary. The previous version had Google at
 * the top followed by an "or" divider, which reads as *the* way in — and for a private single-user app
 * where the password is the account's own credential, promoting the third party above it is the wrong
 * emphasis.
 *
 * **There is no "or" divider.** Two buttons in different weights already say "either of these"; a rule
 * between them implies two *sections*, which is a stronger separation than exists.
 */
export function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({ resolver: zodResolver(signInSchema) })

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    const { error } = await signIn.email(values)
    if (error) {
      // Deliberately generic, and deliberately the same message for "no such account" and
      // "wrong password": distinguishing them turns the login form into an account enumerator.
      setServerError('That email and password combination did not work.')
      return
    }
    onSuccess()
  })

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5" noValidate>
      {serverError !== null && <Alert>{serverError}</Alert>}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email !== undefined}
          {...register('email')}
        />
        {errors.email && <p className="text-body text-status-late">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password !== undefined}
          {...register('password')}
        />
        {errors.password && <p className="text-body text-status-late">{errors.password.message}</p>}
      </div>

      <Button type="submit" size="lg" className="mt-1.5 w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>

      <GoogleButton />
    </form>
  )
}
