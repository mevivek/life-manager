import { useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { signIn } from '@/lib/auth-client'

/**
 * "Continue with Google". Shared by sign-in and sign-up because, unlike email+password, the
 * OAuth flow is identical for both — Google tells us whether the account is new, so having two
 * buttons that do the same thing would only invite them to drift apart.
 *
 * **`callbackURL` must be ABSOLUTE.** Better Auth resolves a relative value against its own
 * `baseURL`, which is the API origin — so `/home` sends the browser to
 * `https://api.mevivek.dev/home` and lands on the API's 404 instead of the app. Deriving it from
 * `window.location.origin` keeps it correct on localhost and on the deployed host without
 * config, and the origin is already in the server's trusted list (`WEB_ORIGIN`), which Better
 * Auth requires or it rejects the redirect outright.
 *
 * There is deliberately no loading state that resolves: a successful call navigates away from
 * the page, so `isRedirecting` only ever turns off on failure.
 */
export function GoogleButton({ path = '/home' }: { path?: string }) {
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function start() {
    setError(null)
    setIsRedirecting(true)
    const callbackURL = new URL(path, window.location.origin).toString()
    const { error: signInError } = await signIn.social({ provider: 'google', callbackURL })
    if (signInError) {
      // The most likely cause by far is a misconfigured redirect URI or missing credentials on
      // the server, neither of which the user can act on — so say what is true without
      // pretending they did something wrong.
      setError('Google sign-in is unavailable right now.')
      setIsRedirecting(false)
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      {error !== null && <Alert>{error}</Alert>}

      {/*
        No "or" divider any more, and no top position.

        This used to sit ABOVE the email fields with a horizontal rule and the word "or" beneath it.
        ADR-0024 puts the ink primary under the fields and this as a secondary below it: two buttons in
        two different weights already say "either of these", whereas a rule between them implies two
        sections. See the note in `SignInForm`.
      */}
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={start}
        disabled={isRedirecting}
      >
        <GoogleMark />
        {isRedirecting ? 'Redirecting…' : 'Continue with Google'}
      </Button>
    </div>
  )
}

/** Google's mark, inlined — an external image would be one more thing that can fail to load. */
function GoogleMark() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.06 12.25c0-.85-.08-1.67-.22-2.45H12v4.64h6.19a5.3 5.3 0 0 1-2.3 3.47v2.9h3.71c2.17-2 3.46-4.95 3.46-8.56Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.12 0 5.74-1.04 7.65-2.8l-3.71-2.9c-1.03.7-2.36 1.11-3.94 1.11-3.02 0-5.58-2.04-6.49-4.79H1.7v2.99A11.99 11.99 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.51 14.62a7.2 7.2 0 0 1 0-4.61V7.02H1.7a11.99 11.99 0 0 0 0 10.59l3.81-2.99Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.7 0 3.22.59 4.42 1.73l3.29-3.29C17.73 1.19 15.11 0 12 0 7.44 0 3.5 2.62 1.7 6.44l3.81 2.99C6.42 6.79 8.98 4.75 12 4.75Z"
      />
    </svg>
  )
}
