import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch, handleUnauthorized } from '../api';
import { useTeams } from '../hooks/useTeams';
import { useEpics, formatDate, type EpicRow } from '../hooks/useEpics';
import { EpicRowComponent } from '../components/EpicRow';

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

  function startEdit(epic: EpicRow) {
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
                  <EpicRowComponent
                    key={epic.id}
                    epic={epic}
                    teamName={getTeamName(epic.teamId)}
                    editingId={editingId}
                    editingTitle={editingTitle}
                    editingDescription={editingDescription}
                    editFieldErrors={editFieldErrors}
                    editError={editError}
                    deletePending={deleteMutation.isPending}
                    onEdit={() => startEdit(epic)}
                    onSave={handleEdit}
                    onCancel={() => { setEditingId(null); setEditingTitle(''); setEditingDescription(''); setEditError(null); setEditFieldErrors({}); }}
                    onDelete={() => handleDelete(epic.id)}
                    onTitleChange={setEditingTitle}
                    onDescriptionChange={setEditingDescription}
                    editMutationPending={editMutation.isPending}
                    deleteMutationPending={deleteMutation.isPending}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
