import { MIN_PASSWORD_LENGTH } from '@life-manager/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignUpForm } from '@/features/auth/SignUpForm'
import { meQueryKey } from '@/features/spaces/useMe'

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
            await queryClient.invalidateQueries({ queryKey: meQueryKey })
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
