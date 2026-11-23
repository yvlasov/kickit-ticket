import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';

interface TeamRow {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  ticketCount: number;
  epicCount: number;
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function Teams() {
  const queryClient = useQueryClient();
  const { data: teams, isLoading } = useTeams();
  const [createName, setCreateName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [renameError, setRenameError] = useState<Record<string, string>>({});
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch('/api/teams', {
        method: 'POST',
        body: JSON.stringify({ name: createName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (body.error?.details) {
          const fields: Record<string, string> = {};
          body.error.details.forEach((d: { field: string; message: string }) => {
            fields[d.field] = d.message;
          });
          setFieldErrors(fields);
        }
        if (res.status === 409) {
          setCreateError('Team name already exists');
        } else if (res.status === 400) {
          setCreateError(body.error?.message ?? 'Validation failed');
        } else {
          setCreateError(body.error?.message ?? 'Failed to create team');
        }
        throw new Error(body.error?.message ?? 'Failed to create team');
      }
      return res;
    },
    onSuccess: () => {
      setCreateName('');
      setCreateError(null);
      setFieldErrors({});
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ teamId, name }: { teamId: string; name: string }) => {
      const res = await apiFetch(`/api/teams/${teamId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json();
        if (res.status === 409) {
          setRenameError((prev) => ({ ...prev, [teamId]: 'Team name already exists' }));
        } else if (res.status === 404) {
          setRenameError((prev) => ({ ...prev, [teamId]: 'Team not found' }));
        } else {
          setRenameError((prev) => ({ ...prev, [teamId]: body.error?.message ?? 'Rename failed' }));
        }
        throw new Error(body.error?.message ?? 'Rename failed');
      }
      return res;
    },
    onSuccess: () => {
      setEditingId(null);
      setEditingName('');
      setRenameError({});
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (teamId: string) => {
      const res = await apiFetch(`/api/teams/${teamId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        const body = await res.json();
        if (res.status === 409) {
          setDeleteError(body.error?.message ?? 'Cannot delete team');
        } else {
          setDeleteError(body.error?.message ?? 'Delete failed');
        }
        throw new Error(body.error?.message ?? 'Delete failed');
      }
      return res;
    },
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setFieldErrors({});
    createMutation.mutate();
  }

  function handleRename(e: FormEvent, teamId: string) {
    e.preventDefault();
    setRenameError({});
    renameMutation.mutate({ teamId, name: editingName });
  }

  function handleDelete(teamId: string) {
    setDeleteError(null);
    deleteMutation.mutate(teamId);
  }

  function startRename(team: TeamRow) {
    setEditingId(team.id);
    setEditingName(team.name);
    setRenameError({});
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-bold mb-6">Teams</h1>

        {deleteError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 mb-4 text-sm">
            {deleteError}
          </div>
        )}

        {/* Create form */}
        <form onSubmit={handleCreate} className="bg-white rounded-lg shadow-md p-4 mb-6">
          <h2 className="text-lg font-semibold mb-3">Create Team</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              placeholder="Team name"
              className={`flex-1 border rounded px-3 py-2 text-sm ${fieldErrors.name ? 'border-red-500' : 'border-gray-300'}`}
              disabled={createMutation.isPending}
            />
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
          {createError && (
            <p className="text-red-600 text-sm mt-2">{createError}</p>
          )}
          {fieldErrors.name && (
            <p className="text-red-600 text-sm mt-2">{fieldErrors.name}</p>
          )}
        </form>

        {/* Team list */}
        {isLoading ? (
          <p className="text-gray-600">Loading...</p>
        ) : teams && teams.length === 0 ? (
          <p className="text-gray-600">No teams yet. Create one above.</p>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Name</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Epics</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Tickets</th>
                  <th className="text-left px-4 py-2 text-sm font-medium text-gray-600">Modified</th>
                  <th className="text-right px-4 py-2 text-sm font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams?.map((team) => (
                  <tr key={team.id} className="border-b last:border-b-0">
                    <td className="px-4 py-2">
                      {editingId === team.id ? (
                        <form onSubmit={(e) => handleRename(e, team.id)} className="flex gap-2">
                          <input
                            type="text"
                            value={editingName}
                            onChange={(e) => setEditingName(e.target.value)}
                            className="border rounded px-2 py-1 text-sm flex-1 border-gray-300"
                          />
                          <button
                            type="submit"
                            disabled={renameMutation.isPending}
                            className="text-green-600 text-sm hover:underline disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditingId(null); setEditingName(''); setRenameError({}); }}
                            className="text-gray-500 text-sm hover:underline"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <span className="font-medium">{team.name}</span>
                      )}
                      {renameError[team.id] && (
                        <p className="text-red-600 text-xs mt-1">{renameError[team.id]}</p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm">{team.epicCount}</td>
                    <td className="px-4 py-2 text-sm">{team.ticketCount}</td>
                    <td className="px-4 py-2 text-sm text-gray-600">{formatDate(team.modifiedAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {editingId !== team.id && (
                        <button
                          onClick={() => startRename(team)}
                          className="text-blue-600 text-sm hover:underline mr-3"
                          disabled={deleteMutation.isPending}
                        >
                          Rename
                        </button>
                      )}
                      <a
                        href={`/tickets?teamId=${team.id}`}
                        className="text-green-600 text-sm hover:underline mr-3"
                      >
                        Tickets
                      </a>
                      <button
                        onClick={() => handleDelete(team.id)}
                        disabled={deleteMutation.isPending || team.epicCount > 0 || team.ticketCount > 0}
                        className={`text-sm ${
                          (team.epicCount > 0 || team.ticketCount > 0)
                            ? 'text-gray-400 cursor-not-allowed'
                            : 'text-red-600 hover:underline'
                        } disabled:opacity-50`}
                        title={
                          team.epicCount > 0 || team.ticketCount > 0
                            ? `Cannot delete: ${team.epicCount} epic(s), ${team.ticketCount} ticket(s)`
                            : ''
                        }
                      >
                        {team.epicCount > 0 || team.ticketCount > 0
                          ? `Delete (${team.epicCount}e, ${team.ticketCount}t)`
                          : 'Delete'}
                      </button>
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
