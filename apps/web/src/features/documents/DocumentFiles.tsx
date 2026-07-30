import { ALLOWED_UPLOAD_MIMES, type DocumentFile, MAX_UPLOAD_BYTES } from '@life-manager/shared'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateShort } from './ExpiryStatus'
import { useDeleteFile, useDownloadFile, useMakeFilePrimary, useUploadFile } from './useDocuments'

/**
 * Scans — the file versions on a document. ADR-0025 §5.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  The design's "Take Photo / Photo Library / Choose File" sheet is NOT built, on purpose.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * The comp drew a three-option picker sheet, and its own caption says what it is: *"The OS decides how
 * you pick — we just take the file."* It is an **illustration of the OS sheet**, not a component to
 * reimplement. A hand-built version would be three buttons that all open the same native input,
 * pretending to be a system control, and it would go stale the moment the OS changed its own.
 *
 * So `Add a scan` clicks a hidden `<input type="file">` and the OS supplies the sheet. `capture` is
 * deliberately not set (documents.md §7): with it, a phone opens the camera and *only* the camera.
 *
 * ── Failures are inline per file, not one banner ──
 *
 * Too large, unsupported type, and a dropped connection are three different sentences with three
 * different fixes, and the design draws each one *on the row it belongs to* with the row's border in
 * `--status-late`. A single alert above the list cannot say which file it means once there is more
 * than one.
 */

/** A local, not-yet-real row: something the user picked that failed before it became a version. */
type Rejected = {
  name: string
  ext: string
  /** The sentence, already written for a person. */
  reason: string
  retryable: boolean
}

export function DocumentFiles({
  documentId,
  files,
}: {
  documentId: string
  files: DocumentFile[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [rejected, setRejected] = useState<Rejected | null>(null)
  const upload = useUploadFile(documentId)
  const download = useDownloadFile(documentId)
  const makePrimary = useMakeFilePrimary(documentId)
  const remove = useDeleteFile(documentId)

  /**
   * Only confirmed versions.
   *
   * A row with `uploaded_at === null` is a presign that never completed — business rule 10's sweep job
   * collects those. Showing them would put a permanent phantom version on the screen after any
   * abandoned upload.
   */
  const confirmed = files.filter((file) => file.uploaded_at !== null)

  async function handleFile(file: File | undefined) {
    setRejected(null)
    if (file === undefined) return

    const ext = extensionOf(file.name)

    /**
     * Both checks happen **before any bytes move**, which is the point of doing them client-side at
     * all — the server enforces the same two rules (business rule 11) and is authoritative, but
     * finding out a 38MB TIFF is too big *after* uploading it is the whole failure this avoids.
     */
    if (file.size > MAX_UPLOAD_BYTES) {
      setRejected({
        name: file.name,
        ext,
        reason: `${formatBytes(file.size)} — too large. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
        retryable: false,
      })
      resetInput()
      return
    }

    if (!ALLOWED_UPLOAD_MIMES.includes(file.type as (typeof ALLOWED_UPLOAD_MIMES)[number])) {
      setRejected({
        name: file.name,
        ext,
        reason: `${file.type || 'That file type'} isn’t supported. PDF, JPEG, PNG, HEIC, WebP or TIFF.`,
        retryable: false,
      })
      resetInput()
      return
    }

    try {
      await upload.mutateAsync(file)
    } catch (error) {
      setRejected({
        name: file.name,
        ext,
        reason:
          error instanceof ApiError
            ? error.message
            : 'The upload failed — the connection dropped. Nothing was saved.',
        // A network failure is worth another go; a rejected file is not.
        retryable: true,
      })
    } finally {
      resetInput()
    }
  }

  function resetInput() {
    // Without this, picking the same file twice in a row fires no `change` event at all.
    if (inputRef.current !== null) inputRef.current.value = ''
  }

  const uploading = upload.isPending

  return (
    <div>
      {confirmed.length === 0 && !uploading && rejected === null && (
        <Card dashed className="p-card">
          <p className="text-row leading-snug">No scan yet</p>
          <p className="mt-1 text-meta leading-relaxed text-ink-3 [text-wrap:pretty]">
            That’s fine — the record still works. A photo makes it useful when you’re not home.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => inputRef.current?.click()}
          >
            Add a scan
          </Button>
        </Card>
      )}

      <ul className="list-none">
        {/* In progress, at the top — it is the newest version, and a bar appearing below existing
            rows makes the user hunt for it. */}
        {uploading && (
          <li>
            <FileRow
              name="Uploading…"
              ext="•••"
              sub={
                upload.progress === null
                  ? 'Preparing'
                  : `${Math.round(upload.progress * 100)}% uploaded`
              }
              progress={upload.progress}
            />
          </li>
        )}

        {rejected !== null && (
          <li>
            <FileRow
              name={rejected.name}
              ext={rejected.ext}
              sub={rejected.reason}
              tone="late"
              action={
                rejected.retryable ? (
                  <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
                    Retry
                  </Button>
                ) : (
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setRejected(null)}
                    aria-label={`Dismiss the problem with ${rejected.name}`}
                  >
                    Dismiss
                  </Button>
                )
              }
            />
          </li>
        )}

        {confirmed.map((file) => (
          <li key={file.id}>
            <FileRow
              name={`Version ${file.version}`}
              ext={extensionFromMime(file.mime)}
              // The size and WHEN it was added — the design's `1.8 MB · Added 12 Sep 2016`.
              //
              // Not the mime type, which is what this showed first: `1.8 MB · application/pdf` puts a
              // developer string on a screen about a passport, and the extension tile beside it
              // already says PDF. `uploaded_at` is the moment the bytes actually landed; `created_at`
              // is when the presign was minted, so the former is the honest "added" date.
              sub={`${formatBytes(file.size_bytes)} · Added ${formatDateShort((file.uploaded_at ?? file.created_at).slice(0, 10))}`}
              primary={file.is_primary}
              action={
                /**
                 * The actions get their OWN LINE, always.
                 *
                 * Three 44px controls plus a PRIMARY pill plus the filename does not fit in 390px — it
                 * clipped "Version 1" to "Versi…", which a screenshot showed and no test could. Wrapping
                 * is better than shrinking here: shrinking would take the buttons below the 44px tap
                 * floor, and the row is `min-h` rather than `h` precisely so it can grow.
                 */
                <div className="flex w-full shrink-0 justify-end gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => download.mutate(file.id)}
                    disabled={download.isPending}
                  >
                    Open
                  </Button>
                  {!file.is_primary && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => makePrimary.mutate(file.id)}
                      disabled={makePrimary.isPending}
                    >
                      Make primary
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => remove.mutate(file.id)}
                    disabled={remove.isPending}
                  >
                    Delete
                  </Button>
                </div>
              }
            />
          </li>
        ))}
      </ul>

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        // The allowlist, so the OS picker greys out what the API would reject anyway.
        accept={ALLOWED_UPLOAD_MIMES.join(',')}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />

      {confirmed.length > 0 && (
        <Button
          variant="dashed"
          className="mt-1 w-full"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          Add another version
        </Button>
      )}
    </div>
  )
}

/**
 * One file row. The `ext` tile is a drawn page with the extension along its foot — a 30×38 rectangle
 * rather than a per-format icon, because seven file types would mean seven icons to draw and the
 * extension already says which it is.
 */
function FileRow({
  name,
  ext,
  sub,
  primary = false,
  tone,
  progress,
  action,
}: {
  name: string
  ext: string
  sub: string
  primary?: boolean
  tone?: 'late'
  /** 0–1 while uploading, `null` when the total is unknown. */
  progress?: number | null
  action?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        // `flex-wrap` so the action group can drop to its own line rather than squeezing the filename
        // out of existence. `min-h` rather than `h` is what lets the row grow when it does.
        'mb-2 flex min-h-16 flex-wrap items-center gap-x-3.5 gap-y-2 rounded-3 border bg-raised px-3.5 py-3',
        tone === 'late' ? 'border-status-late' : 'border-rule',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-[38px] w-[30px] shrink-0 items-end justify-center rounded-1 border-[1.5px] border-ink-3 pb-1 font-mono text-[9px] font-medium text-ink-3"
      >
        {ext}
      </span>
      {/* `basis-0` with `min-w-0`: without a zero basis this block's content sets its own minimum
          width, which is what let it push the actions out of the row in the first place. */}
      <span className="min-w-0 flex-1 basis-0">
        <span className="flex items-center gap-[7px]">
          <span className="truncate text-body font-medium">{name}</span>
          {primary && (
            <span className="shrink-0 rounded-pill bg-ink px-[7px] py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.07em] text-onink">
              Primary
            </span>
          )}
        </span>
        <span
          className={cn(
            'mt-0.5 block text-meta',
            tone === 'late' ? 'text-status-late' : 'text-ink-2',
          )}
        >
          {sub}
        </span>
        {progress !== undefined && (
          <span className="mt-[7px] block h-[3px] rounded-[2px] bg-rule">
            <span
              className="block h-[3px] rounded-[2px] bg-ink transition-[width]"
              // Inline `width` because the value is continuous — a utility class per percentage is
              // 101 classes Tailwind would have to generate, and the animation would step not slide.
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </span>
        )}
      </span>
      {action}
    </div>
  )
}

/** `passport-2016.pdf` → `PDF`. Falls back to a neutral mark rather than showing an empty tile. */
function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot === -1 || dot === filename.length - 1) return 'FILE'
  return filename
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 4)
}

/**
 * The extension for a stored version, from its mime.
 *
 * The original filename is deliberately never stored — `presignUploadRequestSchema` has no `filename`
 * field, because the API chooses every storage key (invariant 6) and a client-supplied name is an
 * obvious path-traversal vector. So the mime is all there is to label a version with.
 */
function extensionFromMime(mime: string): string {
  const known: Record<string, string> = {
    'application/pdf': 'PDF',
    'image/jpeg': 'JPG',
    'image/png': 'PNG',
    'image/heic': 'HEIC',
    'image/webp': 'WEBP',
    'image/tiff': 'TIFF',
  }
  return known[mime] ?? 'FILE'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
