import type {
  ThingCreate,
  ThingListQuery,
  ThingServiceCreate,
  ThingUpdate,
} from '@life-manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

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
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  NONE OF THESE ENDPOINTS EXIST YET. ADR-0029, things.md §10.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * Every call here answers **404** against the deployed API today, so each Things screen renders its
 * error state until another session builds the server half. That is deliberate and temporary, and it
 * is the reason `packages/shared/src/things.ts` was written first: whichever session builds the API
 * implements *that* contract rather than a second guess at it (invariant 9).
 *
 * ── The writes are NOT queued offline, and that is a decision rather than an omission ──
 *
 * Documents route every write through `writeOrQueue` (ADR-0024): an `OfflineError` becomes an outbox
 * entry and the mutation resolves `{ queued: true }`. Things deliberately does not, for two reasons.
 *
 *  1. **`lib/outbox.ts`'s entry union is `document.create | document.update | file.upload`, and
 *     adding a `thing.create` to it is not a small clean change.** `remapTempId` and
 *     `retryWithVersion` both narrow on `kind !== 'document.create'` and then read `.documentId`, so
 *     a fourth kind without that field is a type error in two places that have nothing to do with
 *     things. Widening the queue is the API session's work, alongside the endpoints.
 *  2. **A queue for an API that does not exist would hold writes that can never replay.** The outbox
 *     replays on reconnect and marks a 4xx as a conflict the *user* must resolve — so today a thing
 *     captured offline would come back as an unresolvable conflict naming a 404, which is strictly
 *     worse than the write failing plainly at the moment it was made.
 *
 * So `OfflineError` propagates and the UI says the change was not saved, exactly as ADR-0013 had it.
 * When the endpoints land, the fix is one outbox kind and one `writeOrQueue` wrapper per mutation.
 */

export const thingsKey = ['things'] as const
export const thingListKey = (query: Partial<ThingListQuery>) =>
  [...thingsKey, 'list', query] as const
export const thingDetailKey = (id: string) => [...thingsKey, 'detail', id] as const

export function useThings(query: Partial<ThingListQuery> = {}) {
  return useQuery({
    queryKey: thingListKey(query),
    queryFn: () => api.things.list(query),
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
    mutationFn: (input: ThingCreate) => api.things.create(input, crypto.randomUUID()),
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
    mutationFn: (patch: ThingUpdate) => api.things.update(id, patch, crypto.randomUUID()),
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
      api.things.logService(thingId, input, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}
