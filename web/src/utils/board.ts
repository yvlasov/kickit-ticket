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

export const STATE_ORDER: Array<string> = [
  'new',
  'ready_for_implementation',
  'in_progress',
  'ready_for_acceptance',
  'done',
];

export const STATE_LABELS: Record<string, string> = {
  new: 'New',
  ready_for_implementation: 'Ready for implementation',
  in_progress: 'In progress',
  ready_for_acceptance: 'Ready for acceptance',
  done: 'Done',
};

export interface GroupedTickets {
  [state: string]: Array<TicketRow>;
}

/**
 * Groups a flat list of tickets by their `state`, preserving the API
 * ordering (modifiedAt DESC, id DESC) within each column.
 * Always returns all five state keys, even when empty.
 */
export function groupTicketsByState(
  tickets: Array<TicketRow>,
): GroupedTickets {
  const groups: GroupedTickets = {};
  for (const state of STATE_ORDER) {
    groups[state] = [];
  }
  for (const ticket of tickets) {
    const key = ticket.state;
    if (key in groups) {
      groups[key].push(ticket);
    }
  }
  return groups;
}
