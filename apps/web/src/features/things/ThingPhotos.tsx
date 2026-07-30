import type { ThingPhoto } from '@life-manager/shared'
import { Eyebrow } from '@/components/ui/label'

/**
 * The photos on a thing. things.md §7, comp lines 697–699 (the hero) and 828–842 (the strip).
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  There is NO WAY to fetch a thing's photo bytes, so nothing here opens or uploads one.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `things.md` §5 specifies four photo verbs — `photos::presign-upload`, `::confirm`,
 * `::presign-download`, and the `is_hero` patch — and **none of them exists**, in either half: no route
 * (things.md §10) and no method on `api.things` either. `thingPhotoSchema` deliberately omits
 * `storage_key` (invariant 6: the API chooses it and a client has no use for it), so a photo row on a
 * detail response carries a mime, a size and an `is_hero` flag and *no route to the image*.
 *
 * Two things follow, and both are the `components/ui/toast.tsx` judgement rather than an oversight:
 *
 *  1. **No upload control.** A button that presigns nothing would 404, and a dashed "add a photo" tile
 *     is worse than an absence — it advertises a capability and then fails on tap.
 *  2. **No viewer, and no hero.** `components/PhotoViewer.tsx` takes a `src`, and there is no `src` to
 *     give it. The comp's 172px hero is an image *viewport*; drawn empty and un-droppable it is a screen
 *     of furniture at the top of the record, which is exactly what design.md §7 means by relocating a
 *     void instead of removing one. So the hero is not drawn at all, and the name is the top of the
 *     screen until there is an image pipeline to put above it.
 *
 * What *is* drawn: when the record genuinely holds photos, they are listed — because the record holding
 * them is a fact, and a section that showed nothing would make the app appear to have lost them. Each
 * tile is deliberately **not interactive**: it has no accessible action, so nothing announces a control
 * that cannot act.
 *
 * When the photo verbs land, this file grows a `presign-download` call and the tiles become buttons that
 * open `PhotoViewer`. The strip's geometry is already the comp's, so that is a change of behaviour
 * rather than of layout.
 */
export function ThingPhotos({ photos }: { photos: ThingPhoto[] }) {
  /**
   * Only confirmed uploads.
   *
   * A row with `uploaded_at === null` is a presign that never completed — the same rule
   * `DocumentFiles` applies to a scan, and the same reason: showing them would put a permanent phantom
   * photo on the screen after any abandoned upload.
   */
  const confirmed = photos.filter((photo) => photo.uploaded_at !== null)

  // Nothing to say. Not an empty state: with no upload path there is no instruction to give and no
  // control to offer, and design.md §6 allows an empty state exactly one of each.
  if (confirmed.length === 0) return null

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

      {/*
        The horizontally scrolling strip — 150px tiles, its own `overflow-x-auto`. design.md §7: wide
        content scrolls inside its own container, and **the page body never scrolls sideways**.
      */}
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {confirmed.map((photo) => (
          <div key={photo.id} className="w-[9.375rem] shrink-0">
            <div className="flex h-[6.25rem] w-full items-center justify-center rounded-2 border border-rule-2 bg-sunken">
              {/* Not an `<img>`: there is no URL. Not a button: there is nothing to open. The tile
                  states what it is and stops there. */}
              <span className="font-mono text-label uppercase tracking-label text-ink-3">
                {extensionFromMime(photo.mime)}
              </span>
            </div>
            <p className="mt-1.5 truncate text-meta text-ink-2">
              {formatBytes(photo.size_bytes)}
              {photo.is_hero && ' · Main'}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-2 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
        {/* Honest about the gap rather than silent about it — this is the one place a user could
            reasonably expect to see the image and will not. */}
        These are on the record, but the app can’t open a thing’s photo yet.
      </p>
    </section>
  )
}

/**
 * The extension for a stored photo, from its mime.
 *
 * The original filename is deliberately never stored — `presignPhotoUploadRequestSchema` has no
 * `filename` field, because the API chooses every storage key (invariant 6) and a client-supplied name
 * is an obvious path-traversal vector. So the mime is all there is to label a photo with.
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
