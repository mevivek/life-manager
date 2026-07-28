import { ALLOWED_UPLOAD_MIMES, type DocumentFile, MAX_UPLOAD_BYTES } from '@life-manager/shared'
import { useRef, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'
import { useDeleteFile, useDownloadFile, useMakeFilePrimary, useUploadFile } from './useDocuments'

/**
 * File versions for one document, plus upload. domains/documents.md §7.
 *
 * The upload is the three-step ADR-0008 dance — presign, PUT straight to storage, confirm — wrapped
 * in `useUploadFile`. **Bytes never go through our API.**
 *
 * The size and type checks below are **UX only** (invariant 5): they turn a 400 into an immediate
 * message instead of a round trip. The real enforcement is the server's Zod schema plus the signed
 * `content-length` and `content-type` on the presigned URL, so a client that skipped these checks
 * gets rejected by storage.
 */
export function DocumentFiles({
  documentId,
  files,
}: {
  documentId: string
  files: DocumentFile[]
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const upload = useUploadFile(documentId)
  const download = useDownloadFile(documentId)
  const makePrimary = useMakeFilePrimary(documentId)
  const remove = useDeleteFile(documentId)

  // Only confirmed files are useful to show: an unconfirmed row is an upload that did not finish,
  // and the sweep job will remove it (business rule 10).
  const confirmed = files.filter((file) => file.uploaded_at !== null)

  async function handleFile(file: File | undefined) {
    setLocalError(null)
    if (file === undefined) return

    if (file.size > MAX_UPLOAD_BYTES) {
      setLocalError(`That file is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB limit.`)
      return
    }
    if (!ALLOWED_UPLOAD_MIMES.includes(file.type as (typeof ALLOWED_UPLOAD_MIMES)[number])) {
      setLocalError(`${file.type || 'That file type'} is not supported. Use a PDF or an image.`)
      return
    }

    try {
      await upload.mutateAsync(file)
    } catch (error) {
      setLocalError(
        error instanceof ApiError ? error.message : 'The upload failed. Please try again.',
      )
    } finally {
      // Reset, so re-picking the same file fires `onChange` again.
      if (inputRef.current !== null) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {localError !== null && <Alert variant="destructive">{localError}</Alert>}

      {confirmed.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No file attached yet. The document is still useful without one.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {confirmed.map((file) => (
          <li
            key={file.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Version {file.version}
                {file.is_primary && (
                  <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs">
                    primary
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {file.mime} · {formatBytes(file.size_bytes)}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => download.mutate(file.id)}
                disabled={download.isPending}
              >
                Open
              </Button>
              {!file.is_primary && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => makePrimary.mutate(file.id)}
                  disabled={makePrimary.isPending}
                >
                  Make primary
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove.mutate(file.id)}
                disabled={remove.isPending}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          // `capture` is absent deliberately: with it, a phone opens the camera and *only* the
          // camera. Without it the OS offers camera, photo library and files, which is what
          // "drag-drop and camera capture" (§7) actually needs on mobile.
          accept={ALLOWED_UPLOAD_MIMES.join(',')}
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
        >
          {upload.isPending
            ? 'Uploading…'
            : confirmed.length === 0
              ? 'Attach a file'
              : 'Add a version'}
        </Button>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
