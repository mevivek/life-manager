import { MIN_PASSWORD_LENGTH } from '@life-manager/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignUpForm } from '@/features/auth/SignUpForm'
import { beginSession } from '@/lib/session'

export const Route = createFileRoute('/signup')({ component: SignUpPage })

function SignUpPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          At least {MIN_PASSWORD_LENGTH} characters. There is no password reset yet — keep it in
          your password manager.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SignUpForm
          onSuccess={async () => {
            // Same purge-then-invalidate as sign-in: a brand-new account must never inherit a
            // previous user's persisted cache on a shared device. See lib/session.ts.
            await beginSession(queryClient)
            await navigate({ to: '/home' })
          }}
        />
        <p className="text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="text-primary underline">
            Sign in
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  )
}
