import type { PersonCreate, PersonUpdate } from '@life-manager/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { documentsKey } from '@/features/documents/useDocuments'
import { thingsKey } from '@/features/things/useThings'
import { api } from '@/lib/api'

/**
 * TanStack Query hooks for People — [ADR-0034](../../../../docs/decisions/0034-people-is-a-directory.md).
 * The sibling of `features/things/useThings.ts`, and deliberately the same shape.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *  A rename writes rows in TWO OTHER DOMAINS, so it invalidates three key roots.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * `people` is a directory of names, not a foreign key: `documents.holder` and `things.holder` hold
 * **copies** of the string. `PATCH /people/:id` with a changed name updates every one of those rows
 * in one transaction (ADR-0034), which means the document list, the thing list and every detail
 * already in the cache are stale the moment it returns. Invalidating only `['people']` would leave
 * the library showing "Priya" on rows the server now calls "Priya Nair" until something else
 * happened to refetch — the app would appear to have renamed her *in the directory only*, which is
 * the precise claim the screen says is false.
 *
 * The other three mutations do **not** need that: creating a person adds a name to the offered list
 * and touches no record, and removing one is a soft delete of the directory row alone — the records
 * keep the string they already had. That asymmetry is the whole of ADR-0034 expressed in cache
 * invalidations, so do not "tidy" it into one shared `onSuccess`.
 *
 * ── Not on the persist allowlist, and that is a deliberate omission rather than an oversight ──
 *
 * `lib/persister.ts`'s `PERSISTED_KEY_ROOTS` is `documents · things · me`, and it is **opt-in**
 * (ADR-0024). So this list is not on disk and a cold offline launch shows no directory — the Whose
 * sheet falls back to the holders derived from the documents themselves, which *are* persisted.
 * Adding `'people'` there is a one-word change in a file this work did not own; it is worth doing the
 * day somebody opens People on a train.
 */

/**
 * `['people']` — the root, matching `documentsKey` and `thingsKey`.
 *
 * There is exactly one query, so there is no `list(query)` variant to key: `personListResponseSchema`
 * has **no cursor** on purpose, because a household's directory is a handful of names rather than a
 * feed.
 */
export const peopleKey = ['people'] as const

export function usePeople() {
  return useQuery({ queryKey: peopleKey, queryFn: api.people.list })
}

export function useCreatePerson() {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * A fresh `Idempotency-Key` per submission, generated **here** rather than per attempt — the
     * whole point of the header (conventions/api.md §5). A retry after a dropped response replays
     * the server's first answer instead of filing the same person twice, which on a directory keyed
     * by name is worse than a duplicate row: two identical names are indistinguishable by design
     * (ADR-0034's stated cost).
     */
    mutationFn: (input: PersonCreate) => api.people.create(input, crypto.randomUUID()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: peopleKey })
    },
  })
}

export function useUpdatePerson(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * `patch.version` is **required** by `personUpdateSchema` and must be the version the sheet was
     * **opened** at, not a fresh one — ADR-0024. A patch carrying a just-refetched version defeats
     * the precondition it exists to enforce and turns a refused write into last-write-wins.
     */
    mutationFn: (patch: PersonUpdate) => api.people.update(id, patch, crypto.randomUUID()),
    onSuccess: () => {
      // The three roots the rename actually touched. See the header note — the two cross-domain
      // ones are not defensive, they are what "renames them everywhere they're filed" means.
      void queryClient.invalidateQueries({ queryKey: peopleKey })
      void queryClient.invalidateQueries({ queryKey: documentsKey })
      void queryClient.invalidateQueries({ queryKey: thingsKey })
    },
  })
}

export function useDeletePerson() {
  const queryClient = useQueryClient()

  return useMutation({
    /**
     * Takes the version the caller last read — the same precondition every other delete in this app
     * carries (debt D41, closed). A stale delete is refused with 409 rather than quietly discarding
     * an edit made on another device.
     */
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.people.remove(id, version),
    onSuccess: () => {
      // `['people']` only. Removing somebody leaves every record's `holder` string exactly as it was
      // — that is the sentence on the sheet, and invalidating documents here would imply otherwise.
      void queryClient.invalidateQueries({ queryKey: peopleKey })
    },
  })
}
