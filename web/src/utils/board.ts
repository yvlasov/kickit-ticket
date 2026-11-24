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
 * Returns a new array with the ticket's state replaced.
 * If the ticket is not found or the state is unchanged, returns the original array.
 */
export function moveTicketState(
  tickets: Array<TicketRow>,
  ticketId: string,
  newState: string,
): Array<TicketRow> {
  const current = tickets.find((t) => t.id === ticketId);
  if (!current || current.state === newState) {
    return tickets;
  }
  return tickets.map((t) =>
    t.id === ticketId ? { ...t, state: newState } : t,
  );
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
