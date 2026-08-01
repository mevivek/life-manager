import { Skeleton } from '@/components/ui/skeleton'
import { GoogleButton } from './GoogleButton'

/**
 * The whole of the sign-in screen, on a deployment that has Google — ADR-0035, handoff 5.
 *
 * One button and one line. `SignInForm` and `SignUpForm` both render this and nothing else in that
 * state, which is the point of it being here rather than written twice: the two screens are now
 * *identical*, and two copies would be two chances for them to drift.
 */
export function GoogleOnly() {
  return (
    <div className="flex flex-col gap-2.5">
      <GoogleButton />

      {/*
        Handoff 5's copy, verbatim, and it earns its place by answering the two questions removing the
        password fields raises: what happened to my password, and what does Google get to see.

        "We read your name and email, nothing else" is a claim about the OAuth scopes actually
        requested — Better Auth's default Google scopes are `openid email profile`. If a scope is ever
        added, this sentence has to change with it (CLAUDE.md: a change that alters an invariant
        updates what states it, in the same commit).
      */}
      <p className="pt-1 text-center text-body leading-relaxed text-ink-3 [text-wrap:pretty]">
        One account, no password to forget. We read your name and email, nothing else.
      </p>
    </div>
  )
}

/**
 * What either screen shows while the capability is still in flight.
 *
 * **Not the form, and not the button.** ADR-0035: two screens can disagree with the server for one
 * render, and the one that must never be drawn on a guess is a screen with fields in it — a user can
 * begin typing a password into a form that is about to be replaced. A beat of nothing costs nothing.
 *
 * The bars are the geometry of what replaces them: the 54px control, then the two-line note under it.
 */
export function AuthFormSkeleton() {
  return (
    <div
      className="flex flex-col gap-2.5"
      role="status"
      aria-label="Checking how you can sign in"
      aria-live="polite"
    >
      {/* `h-[3.375rem]` is the `lg` button height from `components/ui/button.tsx` — the placeholder
          has to be the size of the thing it stands in for or the layout jumps when it resolves. */}
      <Skeleton className="h-[3.375rem]" />
      <Skeleton className="mt-1 h-3 w-4/5 self-center rounded-1" />
      <Skeleton className="h-3 w-3/5 self-center rounded-1" />
    </div>
  )
}

/**
 * The one quiet line above the password form when the server has said it has no Google.
 *
 * Stated as a fact about the *deployment*, not as an apology and not as an error: this is the same
 * screen the app had before ADR-0035, and it works. It is shown only when the server actually
 * answered `google: false` — never when the probe failed, because "not configured on this server" is
 * a diagnosis a failed request does not support (`useAuthScreen`).
 */
export function GoogleUnavailableNote() {
  return (
    <p className="text-center text-body text-ink-3 [text-wrap:pretty]">
      Google sign-in isn’t configured on this server.
    </p>
  )
}
