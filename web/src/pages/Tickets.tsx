import { useQuery } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

interface TicketRow {
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function stateLabel(state: string): string {
  return state.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function typeBadge(type: string): string {
  const colors: Record<string, string> = {
    bug: 'bg-red-100 text-red-800',
    feature: 'bg-green-100 text-green-800',
    fix: 'bg-blue-100 text-blue-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
}

export default function Tickets() {
  const teamId = new URLSearchParams(window.location.search).get('teamId');

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['tickets', teamId],
    queryFn: async () => {
      const url = teamId ? `/api/tickets?teamId=${teamId}` : '/api/tickets';
      const res = await apiFetch(url, { method: 'GET' });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch tickets');
      }
      return res.json() as Promise<Array<TicketRow>>;
    },
    enabled: !!teamId,
    retry: false,
  });

  if (!teamId) {
    return (
      <div className="min-h-screen bg-gray-100">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <p className="text-gray-600">Select a team to view tickets.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Tickets</h1>
          <a
            href={`/tickets/new?teamId=${teamId}`}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700"
          >
            New Ticket
          </a>
        </div>

        {isLoading ? (
          <p className="text-gray-600">Loading...</p>
        ) : !tickets || tickets.length === 0 ? (
          <p className="text-gray-600">No tickets for this team.</p>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Title</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Type</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">State</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Modified</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((ticket) => (
                  <tr key={ticket.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <a href={`/tickets/${ticket.id}`} className="text-blue-600 hover:underline font-medium">
                        {ticket.title}
                      </a>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeBadge(ticket.type)}`}>
                        {ticket.type}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm">{stateLabel(ticket.state)}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{formatDate(ticket.modifiedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
