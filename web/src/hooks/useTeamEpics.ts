import { useQuery } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

interface EpicOption {
  id: string;
  title: string;
}

export function useTeamEpics(teamId: string) {
  return useQuery({
    queryKey: ['team-epics', teamId],
    queryFn: async () => {
      const res = await apiFetch(`/api/epics?teamId=${teamId}`, {
        method: 'GET',
      });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch epics');
      }
      return res.json() as Promise<Array<EpicOption>>;
    },
    enabled: !!teamId,
    retry: false,
  });
}
