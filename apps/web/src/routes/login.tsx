import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignInForm } from '@/features/auth/SignInForm'
import { beginSession } from '@/lib/session'

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
            // Purges the on-disk cache, then invalidates `/me` — which is cached as a 401 from
            // before this session existed, so without the invalidation the guard bounces straight
            // back here. The purge matters when a PREVIOUS user's cache survived (a tab closed
            // mid-sign-out, or a server-side expiry): their documents would otherwise rehydrate and
            // render while the refetch was still in flight. See lib/session.ts.
            await beginSession(queryClient)
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
