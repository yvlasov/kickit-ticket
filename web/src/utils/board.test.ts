import { describe, it, expect } from 'vitest';
import { moveTicketState, groupTicketsByState, STATE_ORDER } from './board';

const ticket = (overrides: Partial<{
  id: string;
  title: string;
  type: string;
  state: string;
  epicTitle: string | null;
}> = {}): ReturnType<typeof createTicket> =>
  createTicket({
    id: overrides.id ?? 'abc123',
    title: overrides.title ?? 'Test ticket',
    type: overrides.type ?? 'bug',
    state: overrides.state ?? 'new',
    epicTitle: overrides.epicTitle ?? null,
  });

function createTicket({
  id,
  title,
  type,
  state,
  epicTitle,
}: {
  id: string;
  title: string;
  type: string;
  state: string;
  epicTitle: string | null;
}) {
  return {
    id,
    teamId: 'team-1',
    type,
    state,
    epicId: null,
    epicTitle,
    title,
    body: null,
    createdBy: 'user-1',
    createdByEmail: 'user@example.com',
    createdAt: '2026-01-01T00:00:00Z',
    modifiedAt: '2026-01-01T00:00:00Z',
    teamName: 'Team 1',
  };
}

describe('moveTicketState', () => {
  it('returns a new array when the ticket is found and state changes', () => {
    const tickets = [ticket({ id: 'a', state: 'new' }), ticket({ id: 'b', state: 'done' })];
    const result = moveTicketState(tickets, 'a', 'in_progress');
    expect(result).not.toBe(tickets);
    expect(result).toHaveLength(2);
    expect(result[0].state).toBe('in_progress');
    expect(result[1].state).toBe('done');
  });

  it('returns the same array when the ticket is not found', () => {
    const tickets = [ticket({ id: 'a', state: 'new' })];
    const result = moveTicketState(tickets, 'nonexistent', 'done');
    expect(result).toBe(tickets);
  });

  it('returns the same array when the new state equals the current state', () => {
    const tickets = [ticket({ id: 'a', state: 'new' })];
    const result = moveTicketState(tickets, 'a', 'new');
    expect(result).toBe(tickets);
  });

  it('does not mutate the original array', () => {
    const tickets = [ticket({ id: 'a', state: 'new' })];
    moveTicketState(tickets, 'a', 'done');
    expect(tickets[0].state).toBe('new');
  });

  it('preserves all other ticket properties', () => {
    const t = ticket({
      id: 'a',
      state: 'new',
      title: 'Important bug',
      type: 'bug',
      epicTitle: 'Epic X',
    });
    const tickets = [t];
    const result = moveTicketState(tickets, 'a', 'ready_for_acceptance');
    expect(result[0].id).toBe('a');
    expect(result[0].title).toBe('Important bug');
    expect(result[0].type).toBe('bug');
    expect(result[0].epicTitle).toBe('Epic X');
    expect(result[0].teamId).toBe('team-1');
    expect(result[0].body).toBe(null);
  });
});

describe('groupTicketsByState', () => {
  it('returns all five state keys even when empty', () => {
    const result = groupTicketsByState([]);
    for (const state of STATE_ORDER) {
      expect(result).toHaveProperty(state);
      expect(Array.isArray(result[state])).toBe(true);
      expect(result[state]).toHaveLength(0);
    }
  });

  it('groups tickets by their state', () => {
    const tickets = [
      ticket({ id: 'a', state: 'new' }),
      ticket({ id: 'b', state: 'in_progress' }),
      ticket({ id: 'c', state: 'new' }),
      ticket({ id: 'd', state: 'done' }),
    ];
    const result = groupTicketsByState(tickets);
    expect(result.new).toHaveLength(2);
    expect(result.in_progress).toHaveLength(1);
    expect(result.done).toHaveLength(1);
    expect(result.ready_for_implementation).toHaveLength(0);
    expect(result.ready_for_acceptance).toHaveLength(0);
  });

  it('preserves order within each group', () => {
    const tickets = [
      ticket({ id: 'a', state: 'new' }),
      ticket({ id: 'b', state: 'in_progress' }),
      ticket({ id: 'c', state: 'new' }),
    ];
    const result = groupTicketsByState(tickets);
    expect(result.new[0].id).toBe('a');
    expect(result.new[1].id).toBe('c');
  });

  it('handles a ticket with an unknown state gracefully', () => {
    const tickets = [
      { ...ticket({ state: 'new' }), state: 'unknown_state' as unknown as string },
    ];
    const result = groupTicketsByState(tickets);
    // Unknown state should not appear in any group
    for (const state of STATE_ORDER) {
      expect(result[state]).toHaveLength(0);
    }
  });
});
