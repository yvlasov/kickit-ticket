import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

interface TeamRow {
  id: string;
  name: string;
}

interface EpicRow {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
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

function useEpics(teamId: string | null) {
  const url = teamId ? `/api/epics?teamId=${teamId}` : '/api/epics';
  return useQuery({
    queryKey: ['epics', teamId],
    queryFn: async () => {
      const res = await apiFetch(url, { method: 'GET' });
      if (res.status === 401) {
        handleUnauthorized();
        throw new Error('Unauthorized');
      }
      if (!res.ok) {
        throw new Error('Failed to fetch epics');
      }
      return res.json() as Promise<Array<EpicRow>>;
    },
    retry: false,
  });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Epics() {
  const queryClient = useQueryClient();
  const { data: teams, isLoading: teamsLoading } = useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const { data: epics, isLoading: epicsLoading } = useEpics(selectedTeamId);

  // Create form state
  const [createTeamId, setCreateTeamId] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Record<string, string>>({});

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editEpicTeamId, setEditEpicTeamId] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});

  // Delete state
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/epics', {
        method: 'POST',
        body: JSON.stringify({ teamId: createTeamId, title: createTitle.trim(), description: createDescription.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (body.error?.details) {
          const fields: Record<string, string> = {};
          body.error.details.forEach((d: { field: string; message: string }) => {
            fields[d.field] = d.message;
          });
          setCreateFieldErrors(fields);
        }
        if (res.status === 400) {
          setCreateError(body.error?.message ?? 'Validation failed');
        } else {
          setCreateError(body.error?.message ?? 'Failed to create epic');
        }
        throw new Error(body.error?.message ?? 'Failed to create epic');
      }
      return res;
    },
    onSuccess: () => {
      setCreateTeamId('');
      setCreateTitle('');
      setCreateDescription('');
      setCreateError(null);
      setCreateFieldErrors({});
      queryClient.invalidateQueries({ queryKey: ['epics'] });
    },
  });

  const editMutation = useMutation({
    mutationFn: async ({ epicId, title, description }: { epicId: string; title: string; description: string | null }) => {
      const res = await apiFetch(`/api/epics/${epicId}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: title.trim(), description }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (res.status === 404) {
          setEditError('Epic not found');
        } else if (res.status === 400 && body.error?.details) {
          const fields: Record<string, string> = {};
          body.error.details.forEach((d: { field: string; message: string }) => {
            fields[d.field] = d.message;
          });
          setEditFieldErrors(fields);
          setEditError(body.error?.message ?? 'Validation failed');
        } else {
          setEditError(body.error?.message ?? 'Edit failed');
        }
        throw new Error(body.error?.message ?? 'Edit failed');
      }
      return res;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditingTitle('');
      setEditingDescription('');
      setEditError(null);
      setEditFieldErrors({});
      queryClient.invalidateQueries({ queryKey: ['epics'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (epicId: string) => {
      const res = await apiFetch(`/api/epics/${epicId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json();
        if (res.status === 409) {
          setDeleteError(body.error?.message ?? 'Cannot delete epic');
        } else {
          setDeleteError(body.error?.message ?? 'Delete failed');
        }
        throw new Error(body.error?.message ?? 'Delete failed');
      }
      return res;
    },
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ['epics'] });
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreateFieldErrors({});
    createMutation.mutate();
  }

  function startEdit(epic: EpicRow, teamName: string) {
    setEditingId(epic.id);
    setEditingTitle(epic.title);
    setEditingDescription(epic.description ?? '');
    setEditEpicTeamId(epic.teamId);
    setEditError(null);
    setEditFieldErrors({});
  }

  function handleEdit(e: FormEvent, epicId: string) {
    e.preventDefault();
    setEditError(null);
    setEditFieldErrors({});
    editMutation.mutate({
      epicId,
      title: editingTitle,
      description: editingDescription.trim() === '' ? null : editingDescription.trim(),
    });
  }

  function handleDelete(epicId: string) {
    setDeleteError(null);
    deleteMutation.mutate(epicId);
  }

  function getTeamName(teamId: string): string | undefined {
    return teams?.find((t) => t.id === teamId)?.name;
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold mb-6">Epics</h1>

        {deleteError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">
            {deleteError}
          </div>
        )}

        {/* Team filter */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Filter by team</label>
          <select
            value={selectedTeamId ?? ''}
            onChange={(e) => setSelectedTeamId(e.target.value || null)}
            className="border rounded px-3 py-2 text-sm border-gray-300 w-full"
          >
            <option value="">All teams</option>
            {teams?.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>

        {/* Create form */}
        <form onSubmit={handleCreate} className="bg-white rounded-lg shadow-md p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3">Create Epic</h2>
          <div className="space-y-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Team *</label>
              <select
                value={createTeamId}
                onChange={(e) => setCreateTeamId(e.target.value)}
                className={`border rounded px-3 py-2 text-sm w-full ${createFieldErrors.teamId ? 'border-red-500' : 'border-gray-300'}`}
                disabled={createMutation.isPending}
              >
                <option value="">Select a team</option>
                {teams?.map((team) => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
              {createFieldErrors.teamId && <p className="text-red-600 text-xs mt-1">{createFieldErrors.teamId}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Title *</label>
              <input
                type="text"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="Epic title"
                className={`border rounded px-3 py-2 text-sm w-full ${createFieldErrors.title ? 'border-red-500' : 'border-gray-300'}`}
                disabled={createMutation.isPending}
              />
              {createFieldErrors.title && <p className="text-red-600 text-xs mt-1">{createFieldErrors.title}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Description</label>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="Optional description"
                rows={2}
                className="border rounded px-3 py-2 text-sm w-full border-gray-300"
                disabled={createMutation.isPending}
              />
            </div>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
          {createError && <p className="text-red-600 text-sm mt-2">{createError}</p>}
        </form>

        {/* Epic list */}
        {epicsLoading ? (
          <p className="text-gray-600">Loading...</p>
        ) : !epics || epics.length === 0 ? (
          <p className="text-gray-600">No epics{selectedTeamId ? ' for this team' : ''}. Create one above.</p>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Title</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Team</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Tickets</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Modified</th>
                  <th className="text-right px-4 py-2 text-sm font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {epics.map((epic) => (
                  <tr key={epic.id} className="border-b last:border-b-0">
                    <td className="px-4 py-2">
                      {editingId === epic.id ? (
                        <form onSubmit={(e) => handleEdit(e, epic.id)} className="space-y-1">
                          <input
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className={`border rounded px-2 py-1 text-sm w-full ${editFieldErrors.title ? 'border-red-500' : 'border-gray-300'}`}
                          />
                          {editFieldErrors.title && <p className="text-red-600 text-xs">{editFieldErrors.title}</p>}
                          <textarea
                            value={editingDescription}
                            onChange={(e) => setEditingDescription(e.target.value)}
                            placeholder="Description"
                            rows={2}
                            className="border rounded px-2 py-1 text-sm w-full border-gray-300"
                          />
                          <div className="flex gap-1">
                            <button
                              type="submit"
                              disabled={editMutation.isPending}
                              className="text-green-600 text-sm hover:underline disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingId(null); setEditingTitle(''); setEditingDescription(''); setEditError(null); setEditFieldErrors({}); }}
                              className="text-gray-500 text-sm hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div>
                          <span className="font-medium">{epic.title}</span>
                          {epic.description && <p className="text-sm text-gray-500 mt-1">{epic.description}</p>}
                        </div>
                      )}
                      {editError && editingId === epic.id && (
                        <p className="text-red-600 text-xs mt-1">{editError}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">
                      {editingId === epic.id ? (
                        <input
                          type="text"
                          value={getTeamName(editEpicTeamId) ?? ''}
                          disabled
                          className="border rounded px-2 py-1 text-sm w-full bg-gray-100 text-gray-500 border-gray-300"
                        />
                      ) : (
                        <span className="text-gray-700">{getTeamName(epic.teamId) ?? '?'}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">{epic.ticketCount}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{formatDate(epic.modifiedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {editingId !== epic.id && (
                        <>
                          <button
                            onClick={() => startEdit(epic, getTeamName(epic.teamId) ?? '')}
                            className="text-blue-600 text-sm hover:underline mr-3"
                            disabled={deleteMutation.isPending}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(epic.id)}
                            disabled={deleteMutation.isPending || epic.ticketCount > 0}
                            className={`text-sm ${
                              epic.ticketCount > 0
                                ? 'text-gray-400 cursor-not-allowed'
                                : 'text-red-600 hover:underline'
                            } disabled:opacity-50`}
                            title={epic.ticketCount > 0 ? `Cannot delete: ${epic.ticketCount} ticket(s) reference this epic` : ''}
                          >
                            {epic.ticketCount > 0 ? `Delete (${epic.ticketCount}t)` : 'Delete'}
                          </button>
                        </>
                      )}
                    </td>
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
