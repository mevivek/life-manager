import { MIN_PASSWORD_LENGTH } from '@life-manager/shared'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthMark } from '@/features/auth/AuthMark'
import { SignUpForm } from '@/features/auth/SignUpForm'
import { useAuthScreen } from '@/features/auth/useAuthProviders'
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
  // The same query `SignUpForm` reads — one cached answer, not a second request.
  const screen = useAuthScreen()

  return (
    <div className="flex w-full flex-1 flex-col justify-between gap-8">
      <div className="flex flex-1 flex-col justify-center">
        <AuthMark />
        <h1 className="mt-4 font-heading text-display font-face-h leading-[1.15] tracking-heading">
          One account,
          <br />
          one person’s paperwork.
        </h1>
        {/*
          The no-reset warning is stated HERE, at the moment the password is chosen, rather than
          somewhere it would be read too late. It is a real gap (password reset does not exist yet),
          and burying it would be the kind of quiet omission this app should not make about its own
          limits.

          Which is exactly why it is now conditional: on a Google deployment there is no password on
          this screen to warn about, and a paragraph about choosing one above a screen with no field
          would be the app describing something that is not there. `GoogleOnly`'s own line carries the
          equivalent promise for that case ("no password to forget").
        */}
        {screen.kind === 'password' && (
          <p className="mt-2 max-w-[20rem] text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
            At least {MIN_PASSWORD_LENGTH} characters. There’s no password reset yet, so keep it in
            your password manager.
          </p>
        )}
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
        {/*
          Shown only on the password screen — the counterpart of `/login`'s link, hidden for the same
          reason. See the long note there.

          The asymmetry worth naming: `/login` is the app's front door and `/signup` is reachable only
          from it, so hiding both links on a Google deployment leaves this route with no way back to
          `/login` in the UI. That is fine because there is nothing to go back FOR — the button here
          is the button there. Anyone who deep-links to `/signup` can sign in from it.
        */}
        {screen.kind === 'password' && (
          <p className="flex justify-center gap-1.5 pt-1 text-body text-ink-3">
            <span>Already have an account?</span>
            <Link to="/login" className="text-focus underline-offset-2 hover:underline">
              Sign in
            </Link>
          </p>
        )}
      </div>
    </div>
  )
}
