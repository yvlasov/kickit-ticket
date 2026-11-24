import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { apiFetch, handleUnauthorized } from '../api';

export interface TicketRow {
  id: string;
  teamId: string;
  type: string;
  state: string;
  epicId: string | null;
  epicTitle: string | null;
  title: string;
  body: string | null;
  createdBy: string;
  createdByEmail: string;
  createdAt: string;
  modifiedAt: string;
  teamName: string;
}

export interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  authorEmail: string;
  createdAt: string;
}

export interface EpicOption {
  id: string;
  title: string;
}

export function useTicket(id: string | undefined) {
  return useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/tickets/${id}`, { method: 'GET' });
      if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
      if (res.status === 404) { throw new Error('Not found'); }
      if (!res.ok) { throw new Error('Failed to fetch ticket'); }
      return res.json() as Promise<{ ticket: TicketRow; comments: Array<CommentRow> }>;
    },
    retry: false,
    enabled: !!id,
  });
}

export function useTicketEpics(teamId: string | undefined) {
  return useQuery({
    queryKey: ['epics', teamId],
    queryFn: async () => {
      if (!teamId) return [];
      const res = await apiFetch(`/api/epics?teamId=${teamId}`, { method: 'GET' });
      if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
      return res.json() as Promise<Array<EpicOption>>;
    },
    enabled: !!teamId,
    retry: false,
  });
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function stateLabel(state: string): string {
  return state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function typeBadge(type: string): string {
  const colors: Record<string, string> = {
    bug: 'bg-red-100 text-red-800',
    feature: 'bg-green-100 text-green-800',
    fix: 'bg-blue-100 text-blue-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}
