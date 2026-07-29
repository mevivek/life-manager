import { MIN_PASSWORD_LENGTH } from '@life-manager/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthMark } from '@/features/auth/AuthMark'
import { SignUpForm } from '@/features/auth/SignUpForm'
import { beginSession } from '@/lib/session'

export const Route = createFileRoute('/signup')({ component: SignUpPage })

/**
 * The same shape as `/login` — see that route for why it is not a card.
 *
 * The headline is a *second* sentence rather than a repeat of the front door's. Someone here has
 * already read the promise and chosen to act on it, so restating it would be the app talking to itself.
 */
function SignUpPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  return (
    <div className="flex w-full flex-1 flex-col justify-between gap-8">
      <div className="flex flex-1 flex-col justify-center">
        <AuthMark />
        <h1 className="mt-4 font-serif text-display font-normal leading-[1.15] tracking-tight-display">
          One account,
          <br />
          one person’s paperwork.
        </h1>
        <p className="mt-2 max-w-[20rem] text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
          {/*
            The no-reset warning is stated HERE, at the moment the password is chosen, rather than
            somewhere it would be read too late. It is a real gap (password reset does not exist yet),
            and burying it would be the kind of quiet omission this app should not make about its own
            limits.
          */}
          At least {MIN_PASSWORD_LENGTH} characters. There’s no password reset yet, so keep it in
          your password manager.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        <SignUpForm
          onSuccess={async () => {
            // Same purge-then-invalidate as sign-in: a brand-new account must never inherit a
            // previous user's persisted cache on a shared device. See lib/session.ts.
            await beginSession(queryClient)
            await navigate({ to: '/home' })
          }}
        />
        <p className="flex justify-center gap-1.5 pt-1 text-body text-ink-3">
          <span>Already have an account?</span>
          <Link to="/login" className="text-focus underline-offset-2 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
