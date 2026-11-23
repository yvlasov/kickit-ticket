import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../api';
import { moveTicketState, type TicketRow } from '../utils/board';
import { ticketQueryKey, type BoardFilters } from '../utils/queryKeys';

interface UseUpdateTicketStateOptions {
  teamId: string;
  filters: BoardFilters;
  onError?: (message: string) => void;
}

export function useUpdateTicketState({
  teamId,
  filters,
  onError,
}: UseUpdateTicketStateOptions) {
  const queryClient = useQueryClient();
  const queryKey = ticketQueryKey(teamId, filters);

  return useMutation({
    mutationFn: async ({
      ticketId,
      newState,
    }: {
      ticketId: string;
      newState: string;
    }) => {
      const res = await apiFetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        body: JSON.stringify({ state: newState }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error?.message ?? 'Failed to update ticket state');
      }
      return res.json();
    },
    onMutate: async ({ ticketId, newState }) => {
      await queryClient.cancelQueries({ queryKey });
      const snapshot = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(
        queryKey,
        (old: Array<TicketRow> | undefined) => {
          if (!old) return old;
          return moveTicketState(old, ticketId, newState);
        },
      );
      return { snapshot };
    },
    onError: (_err, _vars, context) => {
      if (context && 'snapshot' in context && context.snapshot) {
        queryClient.setQueryData(queryKey, context.snapshot);
      }
      onError?.('Could not move ticket — change reverted');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
