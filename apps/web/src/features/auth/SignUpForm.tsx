import { zodResolver } from '@hookform/resolvers/zod'
import { type SignUpInput, signUpSchema } from '@life-manager/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signUp } from '@/lib/auth-client'
import { AuthFormSkeleton, GoogleOnly, GoogleUnavailableNote } from './GoogleOnly'
import { useAuthScreen } from './useAuthProviders'

/**
 * Create an account — the same three server-chosen screens as `SignInForm`, for the same reasons
 * (ADR-0035). Read that file's note first.
 *
 * In the Google case this renders **exactly what `/login` renders**, which is not a bug: the OAuth
 * flow is identical for both and Google itself decides whether the account is new. `routes/signup.tsx`
 * carries the only difference — its headline — and drops the copy about choosing a password, which is
 * about a field that is not on screen.
 *
 * React Hook Form + the Zod resolver over the schema from `packages/shared`
 * (conventions/code.md §9). The validation here is UX only — the server re-validates
 * everything and is authoritative (CLAUDE.md invariant 5).
 */
export function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
  const screen = useAuthScreen()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({ resolver: zodResolver(signUpSchema) })

  const submit = handleSubmit(async (values) => {
    setServerError(null)
    const { error } = await signUp.email(values)
    if (error) {
      // Better Auth returns the error rather than throwing. Surfacing it is not optional —
      // silently doing nothing on a failed signup is the worst possible outcome here.
      setServerError(error.message ?? 'Could not create the account.')
      return
    }
    onSuccess()
  })

  // After every hook. See the same three lines in `SignInForm`.
  if (screen.kind === 'loading') return <AuthFormSkeleton />
  if (screen.kind === 'google') return <GoogleOnly />

  return (
    <form onSubmit={submit} className="flex flex-col gap-2.5" noValidate>
      {screen.googleUnconfigured && <GoogleUnavailableNote />}
      {serverError !== null && <Alert>{serverError}</Alert>}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          autoComplete="name"
          aria-invalid={errors.name !== undefined}
          {...register('name')}
        />
        {errors.name && <p className="text-body text-status-late">{errors.name.message}</p>}
      </div>

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
          autoComplete="new-password"
          aria-invalid={errors.password !== undefined}
          {...register('password')}
        />
        {errors.password && <p className="text-body text-status-late">{errors.password.message}</p>}
      </div>

      <Button type="submit" size="lg" className="mt-1.5 w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  )
}
