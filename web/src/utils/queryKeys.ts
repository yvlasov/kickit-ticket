export interface BoardFilters {
  type?: string;
  epic?: string;
  q?: string;
}

export function ticketQueryKey(teamId: string, filters: BoardFilters): unknown[] {
  return ['team-tickets', teamId, filters];
}
