import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

/** The query key everything auth-dependent should be invalidated against on sign-out. */
export const meQueryKey = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: api.me,
  })
}
