import { useState, type FormEvent, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router';
import { apiFetch, handleUnauthorized } from '../api';

interface TeamRow {
  id: string;
  name: string;
}

interface EpicRow {
  id: string;
  title: string;
}

function stateOptions(): Array<{ value: string; label: string }> {
  return [
    { value: 'new', label: 'New' },
    { value: 'ready_for_implementation', label: 'Ready for Implementation' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'ready_for_acceptance', label: 'Ready for Acceptance' },
    { value: 'done', label: 'Done' },
  ];
}

export default function TicketNew() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const defaultTeamId = searchParams.get('teamId') ?? '';

  const [teamId, setTeamId] = useState(defaultTeamId);
  const [type, setType] = useState('bug');
  const [state, setState] = useState('new');
  const [epicId, setEpicId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { data: teams } = useQuery({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await apiFetch('/api/teams', { method: 'GET' });
      if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
      return res.json() as Promise<Array<TeamRow>>;
    },
    retry: false,
  });

  const { data: epics } = useQuery({
    queryKey: ['epics', teamId],
    queryFn: async () => {
      const res = await apiFetch(`/api/epics?teamId=${teamId}`, { method: 'GET' });
      if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
      return res.json() as Promise<Array<EpicRow>>;
    },
    enabled: !!teamId,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/tickets', {
        method: 'POST',
        body: JSON.stringify({
          teamId, type, state: state || 'new',
          epicId: epicId || null,
          title: title.trim(), body: body.trim() || null,
        }),
      });
      if (!res.ok) {
        const bodyData = await res.json();
        if (bodyData.error?.details) {
          const fields: Record<string, string> = {};
          bodyData.error.details.forEach((d: { field: string; message: string }) => {
            fields[d.field] = d.message;
          });
          setFieldErrors(fields);
        }
        setApiError(bodyData.error?.message ?? 'Failed to create ticket');
        throw new Error(bodyData.error?.message ?? 'Failed to create ticket');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets/${data.id}`, { replace: true });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setApiError(null);
    setFieldErrors({});
    createMutation.mutate();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-2xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold mb-6">New Ticket</h1>

        {apiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">
            {apiError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
            <select
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-full border-gray-300 bg-gray-50"
              disabled
            >
              <option value="">Select team</option>
              {teams?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {fieldErrors.teamId && <p className="text-red-600 text-xs mt-1">{fieldErrors.teamId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-full border-gray-300"
            >
              <option value="bug">Bug</option>
              <option value="feature">Feature</option>
              <option value="fix">Fix</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-full border-gray-300"
            >
              {stateOptions().map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Epic</label>
            <select
              value={epicId}
              onChange={(e) => setEpicId(e.target.value)}
              className="border rounded px-3 py-2 text-sm w-full border-gray-300"
              disabled={!teamId}
            >
              <option value="">No epic</option>
              {epics?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
            </select>
            {fieldErrors.epicId && <p className="text-red-600 text-xs mt-1">{fieldErrors.epicId}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ticket title"
              className={`border rounded px-3 py-2 text-sm w-full ${fieldErrors.title ? 'border-red-500' : 'border-gray-300'}`}
            />
            {fieldErrors.title && <p className="text-red-600 text-xs mt-1">{fieldErrors.title}</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Body *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Ticket description"
              rows={4}
              className={`border rounded px-3 py-2 text-sm w-full ${fieldErrors.body ? 'border-red-500' : 'border-gray-300'}`}
            />
            {fieldErrors.body && <p className="text-red-600 text-xs mt-1">{fieldErrors.body}</p>}
          </div>

          <button
            type="submit"
            disabled={createMutation.isPending}
            className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </form>
      </div>
    </div>
  );
}
