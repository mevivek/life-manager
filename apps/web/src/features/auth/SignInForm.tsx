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
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <GoogleButton />

      {serverError !== null && <Alert variant="destructive">{serverError}</Alert>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          aria-invalid={errors.email !== undefined}
          {...register('email')}
        />
        {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password !== undefined}
          {...register('password')}
        />
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
