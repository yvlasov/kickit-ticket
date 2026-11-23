import { useState, type FormEvent, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
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

interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  authorEmail: string;
  createdAt: string;
}

interface EpicRow {
  id: string;
  title: string;
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

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [editType, setEditType] = useState('bug');
  const [editState, setEditState] = useState('new');
  const [editEpicId, setEditEpicId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [apiError, setApiError] = useState<string | null>(null);
  const [editApiError, setEditApiError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  const [noChanges, setNoChanges] = useState(false);

  const { data: ticket, isLoading } = useQuery({
    queryKey: ['ticket', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/tickets/${id}`, { method: 'GET' });
      if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
      if (res.status === 404) { navigate('/'); throw new Error('Not found'); }
      if (!res.ok) { throw new Error('Failed to fetch ticket'); }
      return res.json() as Promise<{ ticket: TicketRow; comments: Array<CommentRow> }>;
    },
    retry: false,
  });

  const { data: epics } = useQuery({
    queryKey: ['epics', ticket?.ticket?.teamId],
    queryFn: async () => {
      if (!ticket?.ticket?.teamId) return [];
      const res = await apiFetch(`/api/epics?teamId=${ticket.ticket.teamId}`, { method: 'GET' });
      if (res.status === 401) { handleUnauthorized(); throw new Error('Unauthorized'); }
      return res.json() as Promise<Array<EpicRow>>;
    },
    enabled: !!ticket?.ticket?.teamId,
    retry: false,
  });

  // Sync edit form with ticket data
  useEffect(() => {
    if (ticket?.ticket) {
      setEditType(ticket.ticket.type);
      setEditState(ticket.ticket.state);
      setEditEpicId(ticket.ticket.epicId ?? '');
      setEditTitle(ticket.ticket.title);
      setEditBody(ticket.ticket.body ?? '');
      setEditApiError(null);
      setEditFieldErrors({});
      setNoChanges(false);
    }
  }, [ticket]);

  const editMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          type: editType,
          state: editState,
          epicId: editEpicId || null,
          title: editTitle.trim(),
          body: editBody.trim() || null,
        }),
      });
      if (!res.ok) {
        const bodyData = await res.json();
        if (res.status === 200) {
          // No-op: server returns 200 with unchanged data
          setNoChanges(true);
          throw new Error('no-op');
        }
        if (bodyData.error?.details) {
          const fields: Record<string, string> = {};
          bodyData.error.details.forEach((d: { field: string; message: string }) => {
            fields[d.field] = d.message;
          });
          setEditFieldErrors(fields);
        }
        setEditApiError(bodyData.error?.message ?? 'Failed to update ticket');
        throw new Error(bodyData.error?.message ?? 'Failed to update ticket');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setEditMode(false);
      setEditApiError(null);
      setNoChanges(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/tickets/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const bodyData = await res.json();
        throw new Error(bodyData.error?.message ?? 'Delete failed');
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      navigate(`/tickets?teamId=${ticket?.ticket?.teamId}`);
    },
  });

  function handleEdit(e: FormEvent) {
    e.preventDefault();
    setEditApiError(null);
    setEditFieldErrors({});
    setNoChanges(false);
    editMutation.mutate();
  }

  function handleDelete() {
    if (window.confirm(`Are you sure you want to delete "${ticket?.ticket?.title}"? This cannot be undone.`)) {
      deleteMutation.mutate();
    }
  }

  function cancelEdit() {
    setEditMode(false);
    setEditApiError(null);
    setEditFieldErrors({});
    setNoChanges(false);
  }

  if (isLoading) return <div className="min-h-screen bg-gray-100 flex items-center justify-center"><p className="text-gray-600">Loading...</p></div>;
  if (!ticket) return null;

  const t = ticket.ticket;

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-3xl mx-auto py-8 px-4">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{t.title}</h1>
          <div className="flex gap-2">
            {!editMode && (
              <>
                <button
                  onClick={() => { setEditMode(true); setEditApiError(null); setEditFieldErrors({}); setNoChanges(false); }}
                  className="text-blue-600 text-sm hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={handleDelete}
                  className="text-red-600 text-sm hover:underline"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>

        {/* Edit form */}
        {editMode && (
          <form onSubmit={handleEdit} className="bg-white rounded-lg shadow-md p-6 mb-6 space-y-4">
            {editApiError && editApiError !== 'no-op' && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{editApiError}</div>
            )}
            {noChanges && (
              <div className="bg-gray-50 border border-gray-200 text-gray-600 rounded p-3 text-sm">No changes detected.</div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select value={editType} onChange={(e) => setEditType(e.target.value)} className="border rounded px-3 py-2 text-sm w-full border-gray-300">
                  <option value="bug">Bug</option>
                  <option value="feature">Feature</option>
                  <option value="fix">Fix</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                <select value={editState} onChange={(e) => setEditState(e.target.value)} className="border rounded px-3 py-2 text-sm w-full border-gray-300">
                  <option value="new">New</option>
                  <option value="ready_for_implementation">Ready for Implementation</option>
                  <option value="in_progress">In Progress</option>
                  <option value="ready_for_acceptance">Ready for Acceptance</option>
                  <option value="done">Done</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Epic</label>
              <select
                value={editEpicId}
                onChange={(e) => setEditEpicId(e.target.value)}
                className="border rounded px-3 py-2 text-sm w-full border-gray-300"
              >
                <option value="">No epic</option>
                {epics?.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
              </select>
              {editFieldErrors.epicId && <p className="text-red-600 text-xs mt-1">{editFieldErrors.epicId}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input type="text" value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className={`border rounded px-3 py-2 text-sm w-full ${editFieldErrors.title ? 'border-red-500' : 'border-gray-300'}`} />
              {editFieldErrors.title && <p className="text-red-600 text-xs mt-1">{editFieldErrors.title}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body *</label>
              <textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} rows={4} className={`border rounded px-3 py-2 text-sm w-full ${editFieldErrors.body ? 'border-red-500' : 'border-gray-300'}`} />
              {editFieldErrors.body && <p className="text-red-600 text-xs mt-1">{editFieldErrors.body}</p>}
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={editMutation.isPending} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {editMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onClick={cancelEdit} className="text-gray-600 text-sm hover:underline">Cancel</button>
            </div>
          </form>
        )}

        {/* Detail view */}
        {!editMode && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500">Type</span>
                <div className="mt-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${typeBadge(t.type)}`}>{t.type}</span>
                </div>
              </div>
              <div>
                <span className="text-sm text-gray-500">State</span>
                <p className="mt-1 text-sm font-medium">{stateLabel(t.state)}</p>
              </div>
            </div>

            {t.epicTitle && (
              <div>
                <span className="text-sm text-gray-500">Epic</span>
                <p className="mt-1 text-sm">{t.epicTitle}</p>
              </div>
            )}

            <div>
              <span className="text-sm text-gray-500">Team</span>
              <p className="mt-1 text-sm">{t.teamName}</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="text-sm text-gray-500">Created by</span>
                <p className="mt-1 text-sm">{t.createdByEmail}</p>
              </div>
              <div>
                <span className="text-sm text-gray-500">Created at</span>
                <p className="mt-1 text-sm">{formatDate(t.createdAt)}</p>
              </div>
            </div>

            <div>
              <span className="text-sm text-gray-500">Modified at</span>
              <p className="mt-1 text-sm">{formatDate(t.modifiedAt)}</p>
            </div>

            <div>
              <span className="text-sm text-gray-500">Body</span>
              <div className="mt-1 text-sm whitespace-pre-wrap">{t.body ?? '—'}</div>
            </div>
          </div>
        )}

        {/* Comments placeholder */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold mb-4">Comments</h2>
          {ticket.comments.length === 0 ? (
            <p className="text-gray-500 text-sm">No comments yet.</p>
          ) : (
            <div className="space-y-3">
              {ticket.comments.map((c) => (
                <div key={c.id} className="border-b pb-3 last:border-b-0">
                  <div className="text-sm text-gray-500 mb-1">{c.authorEmail} · {formatDate(c.createdAt)}</div>
                  <div className="text-sm whitespace-pre-wrap">{c.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
