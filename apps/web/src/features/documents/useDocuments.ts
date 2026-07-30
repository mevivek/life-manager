import type {
  DocumentCreate,
  DocumentListQuery,
  DocumentUpdate,
  ReminderCreate,
} from '@life-manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, OfflineError } from '@/lib/api'
import * as outbox from '@/lib/outbox'
import { canQueueBytes, requestPersistentStorage } from '@/lib/storage-quota'

/**
 * TanStack Query hooks for Documents. conventions/code.md §9: server state lives in Query and is
 * **never copied into `useState`** — that is how two devices get out of sync, which is the one
 * thing this app must not do.
 *
 * Query keys are structured `['documents', ...]` so a single mutation can invalidate every list
 * variant (filters, search, pages) with one prefix, while leaving `['me']` alone.
 */

export const documentsKey = ['documents'] as const
export const documentListKey = (query: Partial<DocumentListQuery>) =>
  [...documentsKey, 'list', query] as const
export const documentDetailKey = (id: string) => [...documentsKey, 'detail', id] as const

export function useDocuments(query: Partial<DocumentListQuery> = {}) {
  return useQuery({
    queryKey: documentListKey(query),
    queryFn: () => api.documents.list(query),
  })
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: documentDetailKey(id),
    queryFn: () => api.documents.get(id),
  })
}

export function useIssuers() {
  return useQuery({
    queryKey: [...documentsKey, 'issuers'],
    queryFn: api.documents.issuers,
    // Autocomplete suggestions do not need to be fresh to the second, and this fires on every
    // focus of the issuer field.
    staleTime: 5 * 60_000,
  })
}

/**
 * Runs a write, and queues it in the outbox if there is no connectivity (ADR-0024).
 *
 * The attempt comes FIRST, and the queue is the fallback — not the other way round. Checking
 * `navigator.onLine` up front and queueing on `false` would be wrong in both directions: it reports
 * `true` behind a captive portal (so the write would be attempted and lost anyway) and it can report
 * `false` on a working connection. An `OfflineError` is proof the request did not reach the server;
 * a status code is proof that it did.
 *
 * Anything else — a 409, a 422 — is rethrown untouched. A request the server has *judged* must not be
 * queued for a retry that would get the same answer.
 */
async function writeOrQueue<T>(
  attempt: () => Promise<T>,
  queued: () => Parameters<typeof outbox.enqueue>[0],
): Promise<T | { queued: true }> {
  try {
    return await attempt()
  } catch (error) {
    if (error instanceof OfflineError) {
      await outbox.enqueue(queued())
      return { queued: true }
    }
    throw error
  }
}

export function useCreateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: DocumentCreate) =>
      /**
       * A fresh `Idempotency-Key` per submission, generated **here** rather than per attempt.
       *
       * That is the whole point of the header (conventions/api.md §5): if the network drops and
       * TanStack Query retries, the retry carries the same key and the server replays the first
       * response instead of creating a second document. A key generated inside the fetch would
       * defeat it entirely.
       */
      writeOrQueue(
        () => api.documents.create(input, crypto.randomUUID()),
        () => ({ kind: 'document.create', tempId: crypto.randomUUID(), input }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsKey })
    },
  })
}

export function useUpdateDocument(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: DocumentUpdate) =>
      writeOrQueue(
        () => api.documents.update(id, patch, crypto.randomUUID()),
        // The patch carries the version the form was populated from, so the queued edit keeps its
        // precondition. Replayed later, it is refused with 409 if the document moved on meanwhile.
        () => ({ kind: 'document.update', documentId: id, patch }),
      ),
    onSuccess: () => {
      // Both the detail and every list: a title or expiry change reorders the default sort.
      void queryClient.invalidateQueries({ queryKey: documentsKey })
    },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * **Not queued offline, deliberately** — the one write that still fails hard with no network.
     *
     * `DELETE` carries no version precondition (debt D41), so a queued delete replayed after the
     * document was edited on another device would destroy that edit with nothing shown. That is the
     * exact failure ADR-0024 exists to prevent, so until D41 is closed the honest behaviour is to
     * refuse: `OfflineError` propagates and the UI says the deletion did not happen.
     */
    mutationFn: (id: string) => api.documents.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsKey })
    },
  })
}

/**
 * The three-step upload from ADR-0008, as one mutation: presign → PUT to storage → confirm.
 *
 * Kept together because a client that stops halfway leaves an unconfirmed row, and the sweep job
 * (business rule 10) is the safety net rather than the intended path. Exposing three separate
 * mutations would make forgetting step three easy.
 */
export function useUploadFile(documentId: string) {
  const queryClient = useQueryClient()

  /**
   * Upload progress, 0–1.
   *
   * Deliberately **not** in the mutation's own state and deliberately not in the Query cache. It
   * changes many times a second, so putting it in the cache would mean a cache write per progress
   * event — and `persister.ts` would then throttle-write the whole cache to IndexedDB while a file is
   * uploading. It is transient view state and belongs in `useState`.
   */
  const [progress, setProgress] = useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      setProgress(0)

      /**
       * Offline capture (ADR-0024): the bytes are queued and uploaded on reconnect.
       *
       * The quota check happens BEFORE anything is stored, and a refusal is a thrown error rather
       * than a silent fallback. ADR-0024 is unambiguous about the ordering of bad outcomes here —
       * refusing a photo is a poor experience, accepting one and losing it to eviction is the worst
       * bug available. See `lib/storage-quota.ts`.
       */
      const attemptUpload = async () => {
        const presigned = await api.files.presignUpload(documentId, {
          // The mime is validated server-side against the allowlist; this cast is the browser's own
          // reported type, and a value outside the allowlist comes back as a 400.
          mime: file.type as PresignUploadMime,
          size_bytes: file.size,
          make_primary: true,
        })

        await api.files.upload(presigned.upload_url, file, setProgress)

        /**
         * Progress is pinned at 1 for the confirm round-trip rather than reset to null.
         *
         * The bytes really are all uploaded at this point, and `:confirm` is a fast call to our own
         * API — but clearing the bar first makes the row flick back to "no progress" for a beat,
         * which reads as the upload restarting.
         */
        setProgress(1)
        return api.files.confirm(documentId, { file_id: presigned.file_id })
      }

      try {
        return await attemptUpload()
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error

        const room = await canQueueBytes(file.size)
        if (!room.ok) throw new Error(room.reason)

        // Asked for only once we know we are actually about to hold bytes — asking on every page
        // load would be a permission prompt for a capability most sessions never use.
        await requestPersistentStorage()

        await outbox.enqueue({
          kind: 'file.upload',
          documentId,
          blob: file,
          mime: file.type,
          sizeBytes: file.size,
        })
        /**
         * `onSettled` clears `progress`, so a queued upload does not leave a stalled bar behind.
         *
         * That matters more here than on the success path: the row would otherwise sit at whatever
         * fraction the failed attempt reached, which reads as an upload still in flight when in fact
         * it is waiting for a network that is not there. `DocumentFiles` shows the queued state
         * instead.
         */
        return { queued: true } as const
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentsKey })
    },
    onSettled: () => setProgress(null),
  })

  return Object.assign(mutation, { progress })
}

/** Narrowed at the API boundary; the browser hands us an arbitrary string. */
type PresignUploadMime = Parameters<typeof api.files.presignUpload>[1]['mime']

export function useDeleteFile(documentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileId: string) => api.files.remove(documentId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentDetailKey(documentId) })
      void queryClient.invalidateQueries({ queryKey: documentsKey })
    },
  })
}

export function useMakeFilePrimary(documentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileId: string) => api.files.makePrimary(documentId, fileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentDetailKey(documentId) })
    },
  })
}

/**
 * Opens a file.
 *
 * Not a `useQuery`: a presigned URL is short-lived and single-use in practice, so fetching one
 * ahead of time and caching it would hand the user a dead link. It is minted at the moment of the
 * click.
 */
export function useDownloadFile(documentId: string) {
  return useMutation({
    mutationFn: async (fileId: string) => {
      const presigned = await api.files.presignDownload(documentId, fileId)
      window.open(presigned.download_url, '_blank', 'noopener,noreferrer')
      return presigned
    },
  })
}

export function useCreateReminder(documentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ReminderCreate) => api.reminders.create(documentId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentDetailKey(documentId) })
    },
  })
}

export function useDeleteReminder(documentId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => api.reminders.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: documentDetailKey(documentId) })
    },
  })
}
