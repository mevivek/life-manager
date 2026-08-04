import type {
  PhotoMime,
  ThingCreate,
  ThingListQuery,
  ThingServiceCreate,
  ThingUpdate,
} from '@life-manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, OfflineError } from '@/lib/api'
import * as outbox from '@/lib/outbox'
import { canQueueBytes, requestPersistentStorage } from '@/lib/storage-quota'

/**
 * TanStack Query hooks for Things. The sibling of `features/documents/useDocuments.ts`, and
 * deliberately the same shape — conventions/code.md §9: server state lives in Query and is **never**
 * copied into `useState`.
 *
 * Query keys are structured `['things', …]` so one mutation invalidates every list variant (filters,
 * pages) with a single prefix while leaving `['documents']` and `['me']` alone. `'things'` is on the
 * persist allowlist in `lib/persister.ts`, so these responses reach IndexedDB — see the note there
 * about the serials that puts on the device (debt D47, widened).
 *
 * **The API exists now.** This block used to open with "none of these endpoints exist yet"; the server
 * half landed and implemented `packages/shared/src/things.ts` unchanged, which is what invariant 9 is
 * for. things.md §10 is the file that tracks what is left.
 *
 * ── The writes ARE queued offline now, and which ones is the deliberate part ──
 *
 * Things route through `writeOrQueue` exactly as documents do (ADR-0024): an `OfflineError` becomes
 * an outbox entry and the mutation resolves `{ queued: true }`. This block used to explain why they
 * did not; the queue's entry union grew four thing kinds and D59's offline half closed with it.
 *
 * **Queued:** create, edit, log a service, upload a photo — the four writes a person makes standing in
 * front of the object, which is where the signal is worst.
 *
 * **Not queued:** deleting a thing, deleting a photo, promoting a hero. A delete stays out for the
 * reason documents' does — a queued destruction that returns hours later as a conflict has nothing to
 * re-apply — and the two photo verbs are decisions *about* a set the user is looking at, which must
 * not be replayed against a set that has since changed.
 */

export const thingsKey = ['things'] as const
export const thingListKey = (query: Partial<ThingListQuery>) =>
  [...thingsKey, 'list', query] as const
export const thingDetailKey = (id: string) => [...thingsKey, 'detail', id] as const

export function useThings(
  query: Partial<ThingListQuery> = {},
  /**
   * `enabled: false` holds the request without unmounting the caller.
   *
   * Added for capture's duplicate warning, which needs the list only once enough of a name has been
   * typed to match on — and a component that mounts and unmounts as the user types would remount the
   * hook on every keystroke. The key is unchanged either way, so an enabled instance still shares the
   * Things screen's fetch.
   */
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: thingListKey(query),
    queryFn: () => api.things.list(query),
    enabled: options.enabled ?? true,
  })
}

export function useThing(id: string) {
  return useQuery({
    queryKey: thingDetailKey(id),
    queryFn: () => api.things.get(id),
  })
}

/**
 * The people a thing has been filed for before, with the relation most recently used for each.
 *
 * Shares the `things` key root, so every thing write invalidates it and the picker offers a name
 * entered thirty seconds ago. A **label**, never a permission — `space_id` is still the only thing
 * deciding who can read a record (things.md §4 rule 6).
 */
export function useThingHolders() {
  return useQuery({
    queryKey: [...thingsKey, 'holders'],
    queryFn: api.things.holders,
    // Autocomplete suggestions do not need to be fresh to the second, and this fires on focus.
    staleTime: 5 * 60_000,
  })
}

export function useCreateThing() {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * A fresh `Idempotency-Key` per submission, generated **here** rather than per attempt — the
     * whole point of the header (conventions/api.md §5). If the network drops and the request is
     * retried, the retry carries the same key and the server replays its first response instead of
     * filing the same laptop twice. A key generated inside the fetch would defeat it entirely.
     */
    mutationFn: (input: ThingCreate) =>
      outbox.writeOrQueue(
        () => api.things.create(input, crypto.randomUUID()),
        () => ({ kind: 'thing.create', tempId: crypto.randomUUID(), input }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

export function useUpdateThing(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * `patch.version` is **required** by `thingUpdateSchema` and must be the version the form was
     * **read** at, not a fresh one — ADR-0024. A patch carrying a just-refetched version defeats the
     * precondition it exists to enforce, silently, and turns a refused write into last-write-wins.
     */
    mutationFn: (patch: ThingUpdate) =>
      outbox.writeOrQueue(
        () => api.things.update(id, patch, crypto.randomUUID()),
        // The patch carries the version the form was read at, so the queued edit keeps its
        // precondition and is refused with 409 if the thing moved on meanwhile.
        () => ({ kind: 'thing.update', thingId: id, patch }),
      ),
    onSuccess: () => {
      // Both the detail and every list: a rename reorders the default `name asc` sort, and an
      // ownership change moves the row in and out of the sum insured.
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

export function useDeleteThing() {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * Takes the version the caller last read — the same precondition a document's delete carries
     * (debt D41, closed). A delete built against stale data is refused with 409 rather than
     * destroying an edit made elsewhere, and required in the signature means a call site that forgets
     * is a type error rather than a lost record.
     *
     * Deleting a thing does **not** delete its documents — `documents.thing_id` is
     * `on delete set null` (things.md §4 rule 5). Any copy on a delete control has to say so.
     */
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.things.remove(id, version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

/**
 * Logs a service.
 *
 * The **server** recomputes `service_due_on` from `serviced_on` plus the interval (things.md §4
 * rule 3), so the invalidation has to reach the list as well as the detail: logging a service moves
 * the next due date, which is what the row's service line draws.
 */
export function useLogService(thingId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: ThingServiceCreate) =>
      outbox.writeOrQueue(
        () => api.things.logService(thingId, input, crypto.randomUUID()),
        /**
         * Queued, and this is the write that most wants to be: a service is logged in a garage or a
         * driveway. `serviced_on` is in the payload rather than derived at send time, so a record
         * replayed tomorrow still says it happened today.
         */
        () => ({ kind: 'thing.service', thingId, input }),
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

// ── Photos ───────────────────────────────────────────────────────────────────
//
// The sibling of `useDocuments.ts`'s file hooks, and read that file's notes before changing these:
// the reasoning about progress state, about `useMutation` versus `useQuery` for a presigned URL, and
// about `XMLHttpRequest` is all there and applies unchanged.

/**
 * Uploads one photo: presign → PUT the bytes → confirm.
 *
 * ── Progress is `useState`, not the Query cache ──
 *
 * Exactly `useUploadFile`'s reasoning: it changes many times a second, and a cache write per progress
 * event would have `persister.ts` throttle-writing the whole cache to IndexedDB for the duration of an
 * upload. It is transient view state.
 *
 * ── Queued offline, exactly like a document's scan ──
 *
 * The bytes go to the outbox on `OfflineError` and upload on reconnect, and the quota check happens
 * BEFORE anything is stored — ADR-0024 is unambiguous that refusing a photo is a poor experience and
 * accepting one then losing it to eviction is the worst bug available. A photo taken of a thing that is
 * itself only in the queue is fine: `remapTempId` re-points it once the create replays.
 *
 * ── `makeHero` is the CALLER's decision, and it must be ──
 *
 * `presignPhotoUploadRequestSchema` defaults `make_hero` to `true`, and confirming a `make_hero` row
 * demotes its siblings in the same transaction. So an upload from the strip's "Add another photo" would
 * silently steal the main slot from whatever the user chose — which is why it is a parameter rather than
 * a default: the empty hero frame passes `true`, the strip passes `false`, and promoting afterwards is a
 * separate deliberate tap (`useMakePhotoHero`).
 */
export function useUploadThingPhoto(thingId: string) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: async ({ file, makeHero }: { file: File; makeHero: boolean }) => {
      setProgress(0)

      const attemptUpload = async () => {
        const presigned = await api.things.photos.presignUpload(thingId, {
          // Validated server-side against `ALLOWED_PHOTO_MIMES`; this is the browser's own reported
          // type, and anything outside the allowlist comes back as a 400 rather than being uploaded.
          mime: file.type as PhotoMime,
          size_bytes: file.size,
          make_hero: makeHero,
        })

        await api.files.upload(presigned.upload_url, file, setProgress)

        // Pinned at 1 for the confirm round-trip rather than reset — see `useUploadFile`: clearing it
        // first makes the tile flick back to "no progress", which reads as the upload restarting.
        setProgress(1)
        return api.things.photos.confirm(thingId, presigned.photo_id)
      }

      try {
        return await attemptUpload()
      } catch (error) {
        if (!(error instanceof OfflineError)) throw error

        const room = await canQueueBytes(file.size)
        if (!room.ok) throw new Error(room.reason)

        // Asked for only once we know we are actually about to hold bytes.
        await requestPersistentStorage()

        await outbox.enqueue({
          kind: 'thing.photo',
          thingId,
          blob: file,
          mime: file.type,
          sizeBytes: file.size,
          // Carried, not defaulted: the server would otherwise promote this to hero on replay and
          // demote whatever the user has chosen since.
          makeHero,
        })
        // `onSettled` clears `progress`, so a queued upload leaves no stalled bar behind.
        return { queued: true } as const
      }
    },
    onSuccess: () => {
      // The whole root: a first photo becomes the hero, which is also the list row's thumbnail.
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
    onSettled: () => setProgress(null),
  })

  return Object.assign(mutation, { progress })
}

export function useDeleteThingPhoto(thingId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (photoId: string) => api.things.photos.remove(thingId, photoId),
    onSuccess: () => {
      // Deleting the hero promotes the newest remaining photo server-side, so the list's thumbnail
      // changes too — hence the root key rather than just the detail.
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

export function useMakePhotoHero(thingId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (photoId: string) => api.things.photos.makeHero(thingId, photoId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

/**
 * Mints a photo's download URL at the moment of the tap.
 *
 * **A mutation and never a query.** A `useQuery` here would land the signed URL in the persisted Query
 * cache and therefore in IndexedDB, which is what `persister.ts`'s `shouldDehydrateMutation: () => false`
 * exists to prevent (security-model.md §6) — and it is short-lived, so a cached one would be a dead link
 * anyway. `DocumentFiles`'s header note is the long version.
 */
export function usePresignPhoto(thingId: string) {
  return useMutation({
    mutationFn: (photoId: string) => api.things.photos.presignDownload(thingId, photoId),
  })
}
