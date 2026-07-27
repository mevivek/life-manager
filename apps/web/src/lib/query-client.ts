import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './api'

/**
 * conventions/code.md §9: server state lives in TanStack Query and is never copied into
 * `useState` — that is how two devices get out of sync, which is the one thing this app must not
 * do.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retrying a 401 or a 404 just delays the redirect and triples the log noise.
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status < 500) return false
          return failureCount < 2
        },
        staleTime: 30_000,
        // Phones suspend tabs constantly; refetching on focus is how the list stays honest.
        refetchOnWindowFocus: true,
      },
    },
  })
}
