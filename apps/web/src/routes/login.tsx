import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AuthMark } from '@/features/auth/AuthMark'
import { SignInForm } from '@/features/auth/SignInForm'
import { beginSession } from '@/lib/session'
import { useFeel } from '@/lib/useFeel'

export const Route = createFileRoute('/login')({ component: LoginPage })

/**
 * The first screen a new person sees. ADR-0025 draws it, and the shape is the point.
 *
 * **Not a card.** It used to be a bordered `Card` floating in the middle of the viewport, which is the
 * shape of a *dialog* — it says "one small task, then back to whatever you were doing". This is the
 * app's front door, so it fills the screen: the mark and the promise sit in the space above, and the
 * form is anchored where a thumb already is.
 *
 * `justify-between` with a `flex-1` block above the form is what does that, rather than a fixed
 * height — on a short landscape phone the top block collapses and the form stays reachable instead of
 * being pushed off the bottom.
 *
 * There is no tab bar here (see `__root.tsx`): navigation on a sign-in screen offers places that
 * bounce you straight back to it.
 */
function LoginPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { copy } = useFeel()

  return (
    // `flex-1` rather than its own `min-h-dvh`: the shell in `__root.tsx` already owns the viewport
    // height and the gutter, and a second `min-h-dvh` inside it overflows by the shell's own padding.
    <div className="flex w-full flex-1 flex-col justify-between gap-8">
      <div className="flex flex-1 flex-col justify-center">
        <AuthMark />
        {/* The hand-placed line break is gone on purpose: the plain register is a different length
            ("Documents, with their expiry dates."), so a fixed `<br/>` would break the wrong line.
            `[text-wrap:balance]` gives an even two-line wrap in whichever register is active. */}
        <h1 className="mt-4 font-heading text-display font-face-h leading-[1.15] tracking-heading [text-wrap:balance]">
          {copy.authHeadline}
        </h1>
        <p className="mt-2 max-w-[19rem] text-row leading-relaxed text-ink-2 [text-wrap:pretty]">
          {/* "Private, single-user" is a real property of the product rather than a marketing line:
              this is one person's archive on their own infrastructure, and saying so is what earns the
              password field. */}
          {copy.authSub}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
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
        <p className="flex justify-center gap-1.5 pt-1 text-body text-ink-3">
          <span>New here?</span>
          <Link to="/signup" className="text-focus underline-offset-2 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}
