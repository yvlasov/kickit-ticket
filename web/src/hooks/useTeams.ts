import { useQuery } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

interface TeamRow {
  id: string;
  name: string;
}

export function useTeams() {
  return useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await apiFetch('/api/teams', { method: 'GET' });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch teams');
      }
      return res.json() as Promise<Array<TeamRow>>;
    },
    retry: false,
  });
}
