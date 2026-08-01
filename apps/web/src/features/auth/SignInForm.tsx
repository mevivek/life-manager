import { zodResolver } from '@hookform/resolvers/zod'
import { type SignInInput, signInSchema } from '@life-manager/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signIn } from '@/lib/auth-client'
import { AuthFormSkeleton, GoogleOnly, GoogleUnavailableNote } from './GoogleOnly'
import { useAuthScreen } from './useAuthProviders'

/**
 * Sign in — **three screens, chosen by the server** (ADR-0035).
 *
 * 1. Google registered → handoff 5's screen: one button, one reassurance line, no fields.
 * 2. Google *not* registered → the password form below, with a line saying so. Not a degraded mode:
 *    it is the screen this app had until handoff 5, and it works.
 * 3. Capability not known yet → a skeleton. Never a guess — see `AuthFormSkeleton`.
 *
 * The password form is deliberately still here, whole. ADR-0035 removes email+password from the
 * *screens*, not from the server: `emailAndPassword.enabled` stays `true` and this is what draws it
 * again the moment a deployment turns out to have no Google. Deleting this branch would turn a
 * missing environment variable back into an outage, which is the failure the whole ADR is about.
 *
 * The previous note here explained why the fields came first and Google second, under ADR-0025. That
 * ordering no longer exists to have a reason: in the Google case there are no fields, and in the
 * password case there is no Google button — showing one that cannot work would be worse than none.
 */
export function SignInForm({ onSuccess }: { onSuccess: () => void }) {
  const screen = useAuthScreen()
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

  // After every hook, never before one. The three returns below are the three screens; the hooks
  // above run identically in all of them.
  if (screen.kind === 'loading') return <AuthFormSkeleton />
  if (screen.kind === 'google') return <GoogleOnly />

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5" noValidate>
      {screen.googleUnconfigured && <GoogleUnavailableNote />}
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
    </form>
  )
}
