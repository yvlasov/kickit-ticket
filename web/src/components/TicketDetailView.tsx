import { type TicketRow } from '../hooks/useTicket';
import { formatDate, stateLabel, typeBadge } from '../hooks/useTicket';

interface DetailViewProps {
  ticket: TicketRow;
}

export function DetailView({ ticket }: DetailViewProps): JSX.Element {
  return (
    <div className="bg-white rounded-lg shadow-md p-6 mb-6 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-gray-500">Type</span>
          <div className="mt-1">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeBadge(ticket.type)}`}>{ticket.type}</span>
          </div>
        </div>
        <div>
          <span className="text-sm text-gray-500">State</span>
          <p className="mt-1 text-sm font-medium">{stateLabel(ticket.state)}</p>
        </div>
      </div>

      {ticket.epicTitle && (
        <div>
          <span className="text-sm text-gray-500">Epic</span>
          <p className="mt-1 text-sm">{ticket.epicTitle}</p>
        </div>
      )}

      <div>
        <span className="text-sm text-gray-500">Team</span>
        <p className="mt-1 text-sm">{ticket.teamName}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="text-sm text-gray-500">Created by</span>
          <p className="mt-1 text-sm">{ticket.createdByEmail}</p>
        </div>
        <div>
          <span className="text-sm text-gray-500">Created at</span>
          <p className="mt-1 text-sm">{formatDate(ticket.createdAt)}</p>
        </div>
      </div>

      <div>
        <span className="text-sm text-gray-500">Modified at</span>
        <p className="mt-1 text-sm">{formatDate(ticket.modifiedAt)}</p>
      </div>

      <div>
        <span className="text-sm text-gray-500">Body</span>
        <div className="mt-1 text-sm whitespace-pre-wrap">{ticket.body ?? '—'}</div>
      </div>
    </div>
  );
}
