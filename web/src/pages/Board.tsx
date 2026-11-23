import { useState, useCallback, useRef, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router';
import {
  DndContext,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { apiFetch, handleUnauthorized } from '../api';
import {
  groupTicketsByState,
  STATE_ORDER,
  STATE_LABELS,
  type TicketRow,
} from '../utils/board';
import { ticketQueryKey, type BoardFilters } from '../utils/queryKeys';
import FilterBar from '../components/FilterBar';
import Toast from '../components/Toast';
import { useUpdateTicketState } from '../hooks/useUpdateTicketState';

interface TeamRow {
  id: string;
  name: string;
}

interface EpicOption {
  id: string;
  title: string;
}

function useTeams() {
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

function useTeamEpics(teamId: string) {
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

function buildQuery(filters: BoardFilters): string {
  const parts: Array<string> = [];
  if (filters.type) parts.push(`type=${encodeURIComponent(filters.type)}`);
  if (filters.epic) parts.push(`epic=${encodeURIComponent(filters.epic)}`);
  if (filters.q) parts.push(`q=${encodeURIComponent(filters.q)}`);
  return parts.join('&');
}

function typeBadge(type: string): string {
  const colors: Record<string, string> = {
    bug: 'bg-red-100 text-red-800',
    feature: 'bg-green-100 text-green-800',
    fix: 'bg-blue-100 text-blue-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

function SkeletonColumn(): JSX.Element {
  return (
    <div className="bg-gray-100 rounded-lg p-3 flex-1 min-w-0">
      <div className="h-5 bg-gray-300 rounded w-32 mb-3 animate-pulse" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white rounded p-3 mb-2 animate-pulse">
          <div className="h-4 bg-gray-300 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
        </div>
      ))}
    </div>
  );
}

function CardSkeleton(): JSX.Element {
  return (
    <div className="bg-white rounded p-3 mb-2 animate-pulse">
      <div className="h-4 bg-gray-300 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-1/2" />
    </div>
  );
}

function DraggableCard({
  ticket,
  justDraggedRef,
}: {
  ticket: TicketRow;
  justDraggedRef: React.MutableRefObject<boolean>;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: ticket.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  return (
    <a
      ref={setNodeRef}
      style={style}
      draggable={false}
      {...attributes}
      {...listeners}
      href={`/tickets/${ticket.id}`}
      className="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"
      onMouseDown={() => { justDraggedRef.current = true; }}
      onClick={(e) => { if (justDraggedRef.current) e.preventDefault(); }}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-sm text-gray-900 truncate">
          {ticket.title}
        </span>
        <span
          className={`inline-block px-2 py-0.5 rounded text-xs font-medium ml-2 flex-shrink-0 ${typeBadge(ticket.type)}`}
        >
          {ticket.type}
        </span>
      </div>
      {ticket.epicTitle && (
        <p className="text-xs text-gray-500 truncate">{ticket.epicTitle}</p>
      )}
    </a>
  );
}

function DroppableColumn({
  state,
  tickets,
  isLoading,
  onStateChange,
  justDraggedRef,
}: {
  state: string;
  tickets: Array<TicketRow>;
  isLoading: boolean;
  onStateChange: (ticketId: string, newState: string) => void;
  justDraggedRef: React.MutableRefObject<boolean>;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  const label = STATE_LABELS[state] ?? state;

  return (
    <div
      ref={setNodeRef}
      className="bg-gray-100 rounded-lg p-3 flex-1 min-w-0 flex flex-col"
      style={{
        outline: isOver ? '2px solid #3b82f6' : '2px solid transparent',
        outlineOffset: '-2px',
      }}
    >
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{label}</h3>
      {isLoading ? (
        <>
          <CardSkeleton />
          <CardSkeleton />
        </>
      ) : tickets.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-4">No tickets</p>
      ) : (
        <div className="space-y-2 flex-1">
          {tickets.map((t) => (
            <DraggableCard key={t.id} ticket={t} justDraggedRef={justDraggedRef} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function Board() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const {
    data: teams,
    isLoading: teamsLoading,
    error: teamsError,
  } = useTeams();

  const selectedTeamId = searchParams.get('teamId') ?? '';

  const filters: BoardFilters = {
    type: searchParams.get('type') ?? undefined,
    epic: searchParams.get('epic') ?? undefined,
    q: searchParams.get('q') ?? undefined,
  };

  const queryString = buildQuery(filters);

  const {
    data: epics,
    isLoading: epicsLoading,
  } = useTeamEpics(selectedTeamId);

  const {
    data: tickets,
    isLoading: ticketsLoading,
    error: ticketsError,
    refetch,
  } = useQuery({
    queryKey: ticketQueryKey(selectedTeamId, filters),
    queryFn: async () => {
      const url = queryString
        ? `/api/tickets?teamId=${selectedTeamId}&${queryString}`
        : `/api/tickets?teamId=${selectedTeamId}`;
      const res = await apiFetch(url, {
        method: 'GET',
      });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch tickets');
      }
      return res.json() as Promise<Array<TicketRow>>;
    },
    enabled: !!selectedTeamId,
    retry: false,
  });

  const [autoSelected] = useState(false);
  const [autoSelectedRef] = useState({ current: false });

  if (teamsError) {
    setError('Failed to load teams');
  } else if (ticketsError) {
    setError('Failed to load tickets');
  }

  if (!autoSelectedRef.current && teams && teams.length > 0 && !selectedTeamId) {
    autoSelectedRef.current = true;
    setSearchParams({ teamId: teams[0].id });
  }

  function handleTeamChange(e: FormEvent<HTMLSelectElement>) {
    const newTeamId = (e.currentTarget.value as string) || '';
    if (newTeamId) {
      setSearchParams({ teamId: newTeamId });
    }
  }

  function handleFilterChange(newFilters: BoardFilters) {
    const params: Record<string, string> = { teamId: selectedTeamId };
    if (newFilters.type) params.type = newFilters.type;
    if (newFilters.epic) params.epic = newFilters.epic;
    if (newFilters.q) params.q = newFilters.q;
    setSearchParams(params, { replace: true });
  }

  const updateState = useUpdateTicketState({
    teamId: selectedTeamId,
    filters,
    onError: setToastMessage,
  });

  const justDraggedRef = useRef(false);

  function handleStateChange(ticketId: string, newState: string) {
    updateState.mutate({ ticketId, newState });
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const ticketId = active.id as string;
    const newState = over.id as string;

    if (!STATE_ORDER.includes(newState)) return;

    const draggedTicket = tickets?.find((t) => t.id === ticketId);
    if (draggedTicket && draggedTicket.state === newState) return;

    updateState.mutate({ ticketId, newState });

    justDraggedRef.current = true;
    window.setTimeout(() => { justDraggedRef.current = false; }, 100);
  }

  // No teams at all
  if (!teamsLoading && (!teams || teams.length === 0)) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <h1 className="text-2xl font-bold mb-4">Board</h1>
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-gray-600 mb-4">
              No teams yet. Create a team to get started.
            </p>
            <a
              href="/"
              className="inline-block bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
            >
              Go to Teams
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (!selectedTeamId) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <h1 className="text-2xl font-bold mb-4">Board</h1>
          <p className="text-gray-600">Select a team to view the board.</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">Board</h1>
            <div className="flex gap-2">
              <a
                href={`/tickets/new?teamId=${selectedTeamId}`}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
              >
                New Ticket
              </a>
            </div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <p className="text-red-700 mb-3">{error}</p>
            <button
              onClick={() => {
                setError(null);
                refetch();
              }}
              className="bg-red-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const grouped = tickets ? groupTicketsByState(tickets) : {};

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-full mx-auto py-4 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Board</h1>
          <div className="flex items-center gap-3">
            <select
              value={selectedTeamId}
              onChange={handleTeamChange}
              className="border rounded px-3 py-2 text-sm border-gray-300 bg-white"
            >
              {teams?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <a
              href={`/tickets/new?teamId=${selectedTeamId}`}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
            >
              New Ticket
            </a>
          </div>
        </div>

        {/* Filters */}
        <FilterBar
          filters={filters}
          onChange={handleFilterChange}
          teamId={selectedTeamId}
          epics={epics ?? []}
        />

        {/* Board columns */}
        {teamsLoading || ticketsLoading ? (
          <div className="flex gap-4 overflow-x-auto">
            {STATE_ORDER.map((state) => (
              <SkeletonColumn key={state} />
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-4 overflow-x-auto pb-4">
              {STATE_ORDER.map((state) => (
                <DroppableColumn
                  key={state}
                  state={state}
                  tickets={grouped[state] ?? []}
                  isLoading={false}
                  onStateChange={handleStateChange}
                  justDraggedRef={justDraggedRef}
                />
              ))}
            </div>
          </DndContext>
        )}
      </div>

      {toastMessage && (
        <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
      )}
    </div>
  );
}
