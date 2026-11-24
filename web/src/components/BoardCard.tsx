import { useEffect, type MutableRefObject } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { type TicketRow } from '../utils/board';

function typeBadge(type: string): string {
  const colors: Record<string, string> = {
    bug: 'bg-red-100 text-red-800',
    feature: 'bg-green-100 text-green-800',
    fix: 'bg-blue-100 text-blue-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

export function CardSkeleton(): JSX.Element {
  return (
    <div className="bg-white rounded p-3 mb-2 animate-pulse">
      <div className="h-4 bg-gray-300 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-1/2" />
    </div>
  );
}

export function BoardCard({
  ticket,
  justDraggedRef,
}: {
  ticket: TicketRow;
  justDraggedRef: MutableRefObject<boolean>;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: ticket.id });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };

  useEffect(() => {
    const clickHandler = (e: MouseEvent) => {
      if (justDraggedRef.current) {
        const anchor = (e.target as HTMLElement)?.closest('a');
        if (anchor) e.preventDefault();
      }
    };
    document.addEventListener('click', clickHandler, { capture: true });
    return () => document.removeEventListener('click', clickHandler, { capture: true });
  }, [justDraggedRef]);

  return (
    <a
      ref={setNodeRef}
      style={style}
      draggable={false}
      {...attributes}
      {...listeners}
      href={`/tickets/${ticket.id}`}
      className="block bg-white rounded p-3 shadow-sm hover:shadow-md transition-shadow"
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
