import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignInForm } from '@/features/auth/SignInForm'
import { meQueryKey } from '@/features/spaces/useMe'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Your documents, assets, money, people and notes.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SignInForm
          onSuccess={async () => {
            // The cached `/me` is from before this session existed — a 401. Invalidate before
            // navigating or the guard bounces straight back here.
            await queryClient.invalidateQueries({ queryKey: meQueryKey })
            await navigate({ to: '/home' })
          }}
        />
        <p className="text-sm text-muted-foreground">
          No account yet?{' '}
          <Link to="/signup" className="text-primary underline">
            Create one
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  )
}
