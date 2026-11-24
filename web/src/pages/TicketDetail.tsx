import { useState, type FormEvent, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router';
import { apiFetch, handleUnauthorized } from '../api';
import { useTicket, useTicketEpics } from '../hooks/useTicket';
import { EditForm } from '../components/TicketEditForm';
import { DetailView } from '../components/TicketDetailView';
import { CommentsSection } from '../components/CommentsSection';

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
  const [editApiError, setEditApiError] = useState<string | null>(null);
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  const [noChanges, setNoChanges] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentApiError, setCommentApiError] = useState<string | null>(null);

  const { data: ticket, isLoading } = useTicket(id);
  const { data: epics } = useTicketEpics(ticket?.ticket?.teamId);

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

  const commentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch(`/api/tickets/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: commentBody }),
      });
      if (!res.ok) {
        const bodyData = await res.json();
        if (bodyData.error?.details) {
          setCommentApiError(bodyData.error.details[0]?.message ?? bodyData.error.message);
        } else {
          setCommentApiError(bodyData.error?.message ?? 'Failed to add comment');
        }
        throw new Error(bodyData.error?.message ?? 'Failed to add comment');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
      setCommentBody('');
      setCommentApiError(null);
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

  function handleComment(e: FormEvent) {
    e.preventDefault();
    setCommentApiError(null);
    commentMutation.mutate();
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

        {editMode && (
          <EditForm
            editType={editType}
            editState={editState}
            editEpicId={editEpicId}
            editTitle={editTitle}
            editBody={editBody}
            editApiError={editApiError}
            editFieldErrors={editFieldErrors}
            noChanges={noChanges}
            epics={epics ?? []}
            editMutationPending={editMutation.isPending}
            onTypeChange={setEditType}
            onStateChange={setEditState}
            onEpicChange={setEditEpicId}
            onTitleChange={setEditTitle}
            onBodyChange={setEditBody}
            onSubmit={handleEdit}
            onCancel={cancelEdit}
          />
        )}

        {!editMode && <DetailView ticket={t} />}

        <CommentsSection
          comments={ticket.comments}
          commentBody={commentBody}
          commentApiError={commentApiError}
          commentMutationPending={commentMutation.isPending}
          onCommentBodyChange={setCommentBody}
          onCommentSubmit={handleComment}
        />
      </div>
    </div>
  );
}
