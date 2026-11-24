import { useDroppable } from '@dnd-kit/core';
import { STATE_LABELS, type TicketRow } from '../utils/board';
import { BoardCard, CardSkeleton } from './BoardCard';

export function SkeletonColumn(): JSX.Element {
  return (
    <div className="bg-gray-100 rounded-lg p-3 flex-1 min-w-0">
      <div className="h-5 bg-gray-300 rounded w-32 mb-3 animate-pulse" />
      {[1, 2, 3].map((i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function BoardColumn({
  state,
  tickets,
  isLoading,
  justDraggedRef,
}: {
  state: string;
  tickets: Array<TicketRow>;
  isLoading: boolean;
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
            <BoardCard key={t.id} ticket={t} justDraggedRef={justDraggedRef} />
          ))}
        </div>
      )}
    </div>
  );
}
