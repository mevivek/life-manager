import { zodResolver } from '@hookform/resolvers/zod'
import { type SignUpInput, signUpSchema } from '@life-manager/shared'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { signUp } from '@/lib/auth-client'

/**
 * React Hook Form + the Zod resolver over the schema from `packages/shared`
 * (conventions/code.md §9). The validation here is UX only — the server re-validates
 * everything and is authoritative (CLAUDE.md invariant 5).
 */
export function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      {serverError !== null && <Alert variant="destructive">{serverError}</Alert>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          autoComplete="name"
          aria-invalid={errors.name !== undefined}
          {...register('name')}
        />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>

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
          autoComplete="new-password"
          aria-invalid={errors.password !== undefined}
          {...register('password')}
        />
        {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
      </div>

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  )
}
