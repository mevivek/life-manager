import { ALLOWED_PHOTO_MIMES, type ThingPhoto } from '@life-manager/shared'
import { useEffect, useRef, useState } from 'react'
import { PhotoViewer } from '@/components/PhotoViewer'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/label'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  useDeleteThingPhoto,
  useMakePhotoHero,
  usePresignPhoto,
  useUploadThingPhoto,
} from './useThings'

/**
 * A thing's photos — the **hero** at the top of the record (comp 697–699) and the **strip** further down
 * (comp 828–842). things.md §7.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  This used to draw neither, and that WAS right: there were no endpoints.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The client shipped ahead of the API (ADR-0029), so for a while a thing's photos could be listed from
 * the detail response and nothing else — no bytes, no upload, no viewer. The file said so at length and
 * drew a strip of grey tiles labelled with a mime. The API landed with all four verbs
 * (`photos:presign-upload`, `:confirm`, `:presign-download`, the `is_hero` patch and the delete), so
 * the honest rendering is now the comp's: a real image at the top, a real strip below, and a control
 * that adds one. Debt **D59** is what tracked the gap.
 *
 * The verbs above carry ONE colon, which is what a client sends. `things.routes.ts` registers them with
 * `::` because Fastify reads a bare `:` as a path parameter — a registration escape, not part of the URL
 * (conventions/api.md §2). Writing `::` in `lib/api.ts` 404ed every one of them.
 *
 * ── One `<img src>` on render, and exactly one ──
 *
 * A photo's bytes come from R2 behind a short-lived presigned URL, so an `<img>` costs a
 * `POST …:presign-download`. `DocumentFiles`'s header note explains why the *scans* strip therefore
 * shows filenames rather than previews: one presign per file per paint, with every signed URL alive in
 * the DOM.
 *
 * The hero is the one place that trade goes the other way, and it is bounded on purpose: **one** photo,
 * **one** presign, minted once per mount for whichever photo `is_hero`. The reason it is worth it is
 * that a photograph of the thing *is* the top of this record — a claim pack's first item, and the one
 * thing on the screen that identifies a dishwasher from six feet away. The strip below stays
 * tap-to-open, exactly like a document's scans: N presigns per paint is the thing neither domain does.
 *
 * The URL lives in `useState` and dies with the component. **Never a `useQuery`** — that would persist a
 * credential to IndexedDB, which is what `persister.ts`'s `shouldDehydrateMutation: () => false` exists
 * to prevent (security-model.md §6).
 *
 * ── What is still NOT here ──
 *
 * The **list row's 52×40 thumbnail** (comp 633–639). That is one presign per row — twenty on a full
 * screen — and the comp only gets away with it because its thumbnail mirrors a data URL already in
 * memory. `ThingRow` keeps the kind glyph. If it ever wants the real photo, the answer is a
 * server-rendered thumbnail URL on the list response, not twenty presigns.
 *
 * Photo writes are also **not queued offline** — see `useThings.ts`'s note on the outbox.
 */

/** Confirmed only. A row with `uploaded_at === null` is a presign that never completed. */
function confirmedOf(photos: ThingPhoto[]): ThingPhoto[] {
  return photos.filter((photo) => photo.uploaded_at !== null)
}

/**
 * The hero image. 172px, full width, `rounded-4` — the comp's geometry exactly.
 *
 * Drawn **always**, and when there is no photo it is the control that adds one. That is what the comp's
 * empty hero is: an `image-slot`, which in the prototype is a drop target. An inert empty box at the top
 * of a record would be the furniture design.md §7 warns about; a box that takes a photo is the invitation
 * the comp drew.
 */
export function ThingHero({
  thingId,
  name,
  photos,
}: {
  thingId: string
  name: string
  photos: ThingPhoto[]
}) {
  const confirmed = confirmedOf(photos)
  /**
   * The hero, or the newest confirmed photo as a fallback.
   *
   * The server promotes on upload and on delete, so `is_hero` is normally set. The fallback covers the
   * one shape it cannot: a thing whose photos somehow all sit unpromoted. An empty frame above a record
   * that demonstrably holds photos is the worse failure.
   */
  const hero = confirmed.find((photo) => photo.is_hero) ?? confirmed[0]
  const heroId = hero?.id ?? null

  const [src, setSrc] = useState<string | null>(null)
  const [viewing, setViewing] = useState(false)
  const presign = usePresignPhoto(thingId)
  const presignPhoto = presign.mutateAsync

  /**
   * Mints the URL once per hero photo.
   *
   * Keyed on the photo's id rather than on the array, so a re-render — or a sibling mutation
   * invalidating `['things']` — does not re-presign the same image. `cancelled` guards the late resolve
   * that would otherwise set state on an unmounted component, or paint a stale image after the hero
   * changed.
   *
   * A failure sets nothing and says nothing: the frame falls back to its placeholder. There is no user
   * action to offer for "the image URL could not be minted", and an alert at the top of the record for a
   * decorative failure would be louder than the fact deserves.
   */
  useEffect(() => {
    setSrc(null)
    if (heroId === null) return

    let cancelled = false
    void presignPhoto(heroId)
      .then((response) => {
        if (!cancelled) setSrc(response.download_url)
      })
      .catch(() => {
        /* Placeholder stays. See above. */
      })

    return () => {
      cancelled = true
    }
  }, [heroId, presignPhoto])

  if (hero === undefined) {
    return (
      <div className="pt-1.5">
        {/* `makeHero` — this frame IS the main slot, so a photo taken from it fills it. */}
        <PhotoPicker thingId={thingId} makeHero={true}>
          {({ open, pending, progress, error }) => (
            <>
              <button
                type="button"
                onClick={open}
                disabled={pending}
                className="flex h-[10.75rem] w-full flex-col items-center justify-center gap-1.5 rounded-4 border border-dashed border-rule-2 bg-sunken text-row font-medium text-ink-2 active:bg-rule"
              >
                {/* The comp's own words on the wizard's photo step (comp 1124). */}
                <span>{pending ? 'Adding…' : 'Take a photo of it'}</span>
                <span className="text-meta font-normal text-ink-3">
                  {pending && progress !== null
                    ? `${Math.round(progress * 100)}%`
                    : 'It identifies the thing in a claim'}
                </span>
              </button>
              {error !== null && <Alert className="mt-2">{error}</Alert>}
            </>
          )}
        </PhotoPicker>
      </div>
    )
  }

  return (
    <div className="pt-1.5">
      {/*
        A `<button>`, not a `<div onClick>`. The comp uses `onClickCapture` on a div; that is not
        focusable, is not announced as a control, and cannot be reached without a pointer.

        `disabled` while there is no URL: the frame is on screen before the presign resolves, and a
        control that does nothing for the first 300ms is worse than one that is visibly not ready.
      */}
      <button
        type="button"
        disabled={src === null}
        onClick={() => setViewing(true)}
        className="block h-[10.75rem] w-full overflow-hidden rounded-4 border border-rule-2 bg-sunken"
      >
        {src === null ? (
          <span className="flex h-full items-center justify-center text-meta text-ink-3">
            {name}
          </span>
        ) : (
          /* `object-cover`: the hero is a portrait of the thing and is meant to fill its frame. A
             document's scan is the opposite case and uses `object-contain` — it is read, not admired. */
          <img src={src} alt={name} className="size-full object-cover" />
        )}
      </button>

      {viewing && src !== null && (
        <PhotoViewer src={src} alt={name} onClose={() => setViewing(false)} />
      )}
    </div>
  )
}

/**
 * The strip — every confirmed photo, 150px tiles, its own `overflow-x-auto` so the page body never
 * scrolls sideways (design.md §7).
 *
 * Each tile opens the full-screen viewer, and the URL is minted at the moment of that tap — the same
 * bargain `DocumentFiles` strikes and for the same reason.
 */
export function ThingPhotos({
  thingId,
  name,
  photos,
}: {
  thingId: string
  name: string
  photos: ThingPhoto[]
}) {
  const confirmed = confirmedOf(photos)
  const [viewing, setViewing] = useState<{ src: string; alt: string } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const presign = usePresignPhoto(thingId)
  const makeHero = useMakePhotoHero(thingId)
  const remove = useDeleteThingPhoto(thingId)

  /**
   * Nothing to draw when the record holds no photo — the hero above is already the invitation, and a
   * second empty state offering the same control twice on one screen is duplication, not helpfulness.
   */
  if (confirmed.length === 0) return null

  async function open(photo: ThingPhoto, index: number) {
    setFailure(null)
    try {
      const response = await presign.mutateAsync(photo.id)
      setViewing({ src: response.download_url, alt: labelFor(name, photo, index) })
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error.message
          : 'Couldn’t open that photo — the connection dropped. Nothing was changed.',
      )
    }
  }

  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between gap-2.5 pb-2.5">
        <Eyebrow>Photos</Eyebrow>
        {/* A non-zero count, stated. `file_count` read 0 for the whole of M1 because every fixture
            expected 0 (debt D33), so a count on screen is worth more than one only in a test. */}
        <span className="text-meta text-ink-3">
          {confirmed.length === 1 ? '1 photo' : `${confirmed.length} photos`}
        </span>
      </div>

      {failure !== null && <Alert className="mb-2.5">{failure}</Alert>}

      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {confirmed.map((photo, index) => (
          <div key={photo.id} className="w-[9.375rem] shrink-0">
            <button
              type="button"
              onClick={() => void open(photo, index)}
              className="block h-[6.25rem] w-full overflow-hidden rounded-2 border border-rule-2 bg-sunken"
            >
              {/* No `<img>` here — see the header note. The tile names the photo and opens it. */}
              <span className="flex h-full flex-col items-center justify-center gap-1">
                <span className="font-mono text-label uppercase tracking-label text-ink-3">
                  {extensionFromMime(photo.mime)}
                </span>
                <span className="text-meta text-ink-2">{formatBytes(photo.size_bytes)}</span>
              </span>
            </button>

            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="min-w-0 truncate text-meta text-ink-2">
                {labelFor(name, photo, index)}
              </span>
              {photo.is_hero && (
                /* The comp writes "Primary" on a document's scan and nothing on a thing's photo. "Main"
                   is what the rest of this domain calls `is_hero`, and one word per concept beats
                   inheriting a prototype's inconsistency. */
                <span className="shrink-0 font-mono text-label uppercase tracking-label text-ink-3">
                  Main
                </span>
              )}
            </p>

            <div className="flex flex-wrap items-center">
              {/* Promotion only — there is no demote, by contract. A photo that is already the main one
                  offers nothing, rather than a disabled control announcing itself as unusable. */}
              {!photo.is_hero && (
                <Button
                  variant="quiet"
                  size="bare"
                  className="px-0 text-meta"
                  disabled={makeHero.isPending}
                  onClick={() => makeHero.mutate(photo.id)}
                >
                  Make main
                </Button>
              )}
              <Button
                variant="quiet"
                size="bare"
                className={cn('px-0 text-meta text-status-late', !photo.is_hero && 'ml-3')}
                disabled={remove.isPending}
                onClick={() => remove.mutate(photo.id)}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      {/* `makeHero={false}`: adding a second photo must not silently displace the one the user picked as
          the main image. Promotion is the explicit "Make main" tap above. */}
      <PhotoPicker thingId={thingId} makeHero={false}>
        {({ open: pick, pending, progress, error }) => (
          <>
            <Button
              variant="secondary"
              className="mt-2.5 w-full border-dashed text-ink-2"
              disabled={pending}
              onClick={pick}
            >
              {pending
                ? `Adding…${progress === null ? '' : ` ${Math.round(progress * 100)}%`}`
                : 'Add another photo'}
            </Button>
            {error !== null && <Alert className="mt-2">{error}</Alert>}
          </>
        )}
      </PhotoPicker>

      {viewing !== null && (
        <PhotoViewer src={viewing.src} alt={viewing.alt} onClose={() => setViewing(null)} />
      )}
    </section>
  )
}

/**
 * The hidden `<input type="file">` and the upload, shared by the hero and the strip.
 *
 * A render-prop rather than two copies, because both the empty hero and the strip's button open the same
 * picker and run the same two client-side checks. `capture` is deliberately **not** set (documents.md
 * §7): with it, a phone opens the camera and *only* the camera, and the useful case is often a photo
 * already in the library.
 *
 * `accept` lists the allowlist so the OS filters before the user picks, and both checks below run again
 * on the picked file — `accept` is a hint, not a constraint.
 */
function PhotoPicker({
  thingId,
  makeHero,
  children,
}: {
  thingId: string
  /** Whether the picked photo becomes the main one. See `useUploadThingPhoto`'s note. */
  makeHero: boolean
  children: (state: {
    open: () => void
    pending: boolean
    progress: number | null
    error: string | null
  }) => React.ReactNode
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const upload = useUploadThingPhoto(thingId)

  async function handle(file: File | undefined) {
    setError(null)
    if (file === undefined) return

    /**
     * Both checks happen **before any bytes move**, which is the whole point of doing them client-side:
     * the server enforces the same two rules and is authoritative (business rule 11), but finding out a
     * 38MB photo is too large *after* uploading it over a phone connection is the failure this avoids.
     */
    if (file.size > MAX_PHOTO_BYTES) {
      setError(
        `${formatBytes(file.size)} — too large. The limit is ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`,
      )
      reset()
      return
    }

    if (!ALLOWED_PHOTO_MIMES.includes(file.type as (typeof ALLOWED_PHOTO_MIMES)[number])) {
      setError(
        `${file.type === '' ? 'That file type' : file.type} isn’t supported. JPEG, PNG, HEIC, WebP or TIFF — a photo, not a PDF.`,
      )
      reset()
      return
    }

    try {
      await upload.mutateAsync({ file, makeHero })
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : 'The upload failed — the connection dropped. Nothing was saved.',
      )
    }
    reset()
  }

  /** Clearing the value is what lets the same file be picked again after a failure. */
  function reset() {
    if (inputRef.current !== null) inputRef.current.value = ''
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_PHOTO_MIMES.join(',')}
        className="hidden"
        onChange={(event) => void handle(event.target.files?.[0])}
      />
      {children({
        open: () => inputRef.current?.click(),
        pending: upload.isPending,
        progress: upload.progress,
        error,
      })}
    </>
  )
}

/**
 * The 25 MB ceiling, from `presignPhotoUploadRequestSchema`'s own `.max()`.
 *
 * Written here rather than imported because the contract does not export it as a constant — the number
 * lives inside the Zod schema. `MAX_UPLOAD_BYTES` exists for documents and this is deliberately the same
 * value; if the two ever diverge the contract is the authority, not this line.
 */
const MAX_PHOTO_BYTES = 25 * 1024 * 1024

/**
 * What to call a photo. There is no filename to use.
 *
 * `presignPhotoUploadRequestSchema` has no `filename` field on purpose — the API chooses every storage
 * key (invariant 6) and a client-supplied name is an obvious path-traversal vector — so the label is
 * built from the thing's name and the photo's position. "Bosch dishwasher · 2" is more use in a viewer
 * header than "IMG_4417.HEIC" would have been anyway.
 */
function labelFor(name: string, photo: ThingPhoto, index: number): string {
  return photo.is_hero ? name : `${name} · ${index + 1}`
}

/**
 * The extension for a stored photo, from its mime — the only thing there is to label it with.
 *
 * No PDF entry, and that is not an omission: `ALLOWED_PHOTO_MIMES` is the image half of the document
 * allowlist, because a photo of a boiler is not a PDF (business rule 11).
 */
function extensionFromMime(mime: string): string {
  const known: Record<string, string> = {
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/heic': 'HEIC',
    'image/webp': 'WEBP',
    'image/tiff': 'TIFF',
  }
  return known[mime] ?? 'IMG'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
