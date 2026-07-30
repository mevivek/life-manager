import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/ui/button'

/**
 * The full-screen image viewer — a scan of a document, a photo of a thing. Handoff 4, comp 930–940.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  It is a DARK ROOM, and it says so with `data-theme`, not with three hex values.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The comp writes the ground as `#0A0A09`, the filename as `#B4AFA4` and Close as `#F2EFE8`. Those are
 * not three arbitrary colours: they are `--sunken`, `--ink-2` and `--ink` **from the dark palette**. A
 * photo needs a dark surround in either theme — a warm-paper ground next to a photograph tints it — so
 * the viewer stamps `data-theme="dark"` on its own root and reads the ordinary tokens underneath it.
 *
 * That is exactly what `styles.css`'s `[data-theme="dark"]` block is: a re-declaration of the palette
 * for a subtree, and custom properties inherit. So this file contains **no raw colour** (design.md §1),
 * the viewer looks identical in both themes on purpose, and a palette change reaches it for free. It
 * also drags `--focus` to the dark ring, which is the correct one on a near-black ground.
 *
 * ── It needs a ground, not a shadow ──
 *
 * design.md §5: exactly two things in the app cast a shadow — the sheet and the toast. A full-screen
 * overlay is not one of them and does not want to be. It covers everything, so there is nothing for it
 * to appear to float above; the dark ground is the whole separation.
 *
 * ── The four dialog behaviours, which the comp has none of ──
 *
 * The comp is a click-to-close `<div>`. This is a real dialog, for the same reasons `ui/sheet.tsx`
 * is: **Escape closes, focus is trapped, focus returns to the opener, and the page behind does not
 * scroll.** Those are the things nobody notices are missing until a keyboard user is stranded on a
 * photograph. The implementation is deliberately the same shape as `Sheet`'s so the two read as one
 * pattern rather than two — if you fix a bug in one, look at the other.
 *
 * `prefers-reduced-motion` is **not** handled here. The global reset in `styles.css` neutralises every
 * animation, and re-implementing it per component is how one component ends up disagreeing with the
 * setting (design.md §9).
 *
 * ── Why the caller passes a `src` rather than a file id ──
 *
 * A scan's bytes come from R2 behind a **presigned, short-lived** URL, minted at the moment of the tap
 * (`useDownloadFile`'s note explains why that is a mutation and not a query). This component never
 * mints one and never stores one: it takes the URL its opener already holds, holds it for as long as
 * the image is on screen, and both die together on close. That is what keeps a signed URL out of the
 * persisted Query cache — `persister.ts`'s `shouldDehydrateMutation: () => false`, security-model.md
 * §6. **Do not add a `useQuery` here.**
 */
export function PhotoViewer({
  src,
  /** The image's name — "Version 2", "Boiler, front". Shown top-left and used as the alt text. */
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  /** The box the image is centred in — the part of the ground a press should close on. */
  const groundRef = useRef<HTMLDivElement>(null)
  /** Where focus was before the viewer opened, so it can be handed back on close. */
  const restoreTo = useRef<HTMLElement | null>(null)
  const nameId = useId()

  useEffect(() => {
    restoreTo.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    /**
     * Focus Close, which is the only control in here.
     *
     * Not the panel: a keyboard or switch-control user arriving on a full-screen image wants the way
     * out under their thumb, and focusing the container would make Escape the only exit they are
     * given without pressing Tab first.
     */
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
    const first = focusable?.[0]
    if (first !== undefined) first.focus()
    else panelRef.current?.focus()

    // Same reason as the sheet: without this, a scroll gesture that runs out of image chains to the
    // document underneath, so the screen behind slides while the viewer sits still.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      // Queried on every Tab rather than cached — cheap, and it cannot go stale. With one control the
      // trap is a no-op that keeps focus on Close; with two it wraps.
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (nodes === undefined || nodes.length === 0) return
      const list = Array.from(nodes)
      const firstNode = list[0]
      const lastNode = list[list.length - 1]
      if (firstNode === undefined || lastNode === undefined) return

      if (event.shiftKey && document.activeElement === firstNode) {
        event.preventDefault()
        lastNode.focus()
      } else if (!event.shiftKey && document.activeElement === lastNode) {
        event.preventDefault()
        firstNode.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      restoreTo.current?.focus()
    }
  }, [onClose])

  return (
    /**
     * The dialog **is** the ground, so there is no separate backdrop element to press: a full-screen
     * viewer has no page showing round its edges.
     *
     * ── One handler, and it tests the target rather than stopping propagation ──
     *
     * Pressing the dark area closes. Pressing the **image** does not, and neither does pressing the
     * header — which is chrome, and whose Close button calls `onClose` itself, so letting the press
     * bubble as well would fire it twice.
     *
     * The obvious implementation is `stopPropagation` on the image and the header. It is rejected
     * because both of those are static elements, and hanging a pointer handler on one is what
     * `noStaticElementInteractions` exists to catch — reasonably, since a suppression per decorative
     * box is a suppression nobody reads. Instead the *only* handler is on this element, which carries
     * `role="dialog"`, and it fires for two targets: itself, and the box the image is centred in. Those
     * two together are exactly "the dark area", which is why `groundRef` exists.
     *
     * `onMouseDown` rather than `onClick`, exactly as in `Sheet`: with `onClick` a drag that *starts*
     * on the image and *ends* on the ground counts as a press on the ground and shuts the viewer
     * mid-gesture.
     */
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={nameId}
      tabIndex={-1}
      // `data-theme="dark"` is the palette switch described above — every colour below is a token.
      data-theme="dark"
      className="fixed inset-0 z-50 flex flex-col bg-sunken [animation:ledger-rise_var(--m-base)_var(--m-ease)]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget || event.target === groundRef.current) onClose()
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-3.5 pb-2.5">
        {/* The dialog's accessible name, and the one label a person needs: which version they are
            looking at. `truncate` because a name is arbitrary and the header is one line. */}
        <span id={nameId} className="min-w-0 truncate text-body text-ink-2">
          {alt}
        </span>
        <Button variant="quiet" size="sm" className="shrink-0 text-row text-ink" onClick={onClose}>
          Close
        </Button>
      </div>

      {/*
        `min-h-0` on a flex child is what lets the image actually shrink. Without it the child's
        implicit `min-height: auto` is the image's intrinsic height, so a tall scan overflows the
        viewport instead of being contained — the image looks correct and the header scrolls away.
      */}
      <div
        ref={groundRef}
        className="flex min-h-0 flex-1 items-center justify-center px-3 pb-5"
      >
        {/*
          `object-contain` with both maxima: the whole page must be visible, because a document is
          read rather than admired, and cropping the top of a passport to fill the frame is the one
          thing this screen must not do.
        */}
        <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
      </div>
    </div>
  )
}

/** What counts as focusable for the trap. The same list `ui/sheet.tsx` uses; keep them in step. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
