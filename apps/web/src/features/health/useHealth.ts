import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    // Public endpoint; there is nothing to invalidate and no reason to poll it.
    staleTime: 60_000,
  })
}
