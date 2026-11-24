import { useQuery } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

export interface EpicRow {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
}

export function useEpics(teamId: string | null) {
  const url = teamId ? `/api/epics?teamId=${teamId}` : '/api/epics';
  return useQuery({
    queryKey: ['epics', teamId],
    queryFn: async () => {
      const res = await apiFetch(url, { method: 'GET' });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch epics');
      }
      return res.json() as Promise<Array<EpicRow>>;
    },
    retry: false,
  });
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
