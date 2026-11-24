import { type FormEvent } from 'react';
import { type EpicOption } from '../hooks/useTicket';

interface EditFormProps {
  editType: string;
  editState: string;
  editEpicId: string;
  editTitle: string;
  editBody: string;
  editApiError: string | null;
  editFieldErrors: Record<string, string>;
  noChanges: boolean;
  epics: Array<EpicOption>;
  editMutationPending: boolean;
  onTypeChange: (v: string) => void;
  onStateChange: (v: string) => void;
  onEpicChange: (v: string) => void;
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
}

export function EditForm({
  editType, editState, editEpicId, editTitle, editBody,
  editApiError, editFieldErrors, noChanges, epics,
  editMutationPending,
  onTypeChange, onStateChange, onEpicChange, onTitleChange, onBodyChange,
  onSubmit, onCancel,
}: EditFormProps): JSX.Element {
  return (
    <form onSubmit={onSubmit} className="bg-white rounded-lg shadow-md p-6 mb-6 space-y-4">
      {editApiError && editApiError !== 'no-op' && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{editApiError}</div>
      )}
      {noChanges && (
        <div className="bg-gray-50 border border-gray-200 text-gray-600 rounded p-3 text-sm">No changes detected.</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
          <select value={editType} onChange={(e) => onTypeChange(e.target.value)} className="border rounded px-3 py-2 text-sm w-full border-gray-300">
            <option value="bug">Bug</option>
            <option value="feature">Feature</option>
            <option value="fix">Fix</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
          <select value={editState} onChange={(e) => onStateChange(e.target.value)} className="border rounded px-3 py-2 text-sm w-full border-gray-300">
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
        <select value={editEpicId} onChange={(e) => onEpicChange(e.target.value)} className="border rounded px-3 py-2 text-sm w-full border-gray-300">
          <option value="">No epic</option>
          {epics.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        {editFieldErrors.epicId && <p className="text-red-600 text-xs mt-1">{editFieldErrors.epicId}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
        <input type="text" value={editTitle} onChange={(e) => onTitleChange(e.target.value)} className={`border rounded px-3 py-2 text-sm w-full ${editFieldErrors.title ? 'border-red-500' : 'border-gray-300'}`} />
        {editFieldErrors.title && <p className="text-red-600 text-xs mt-1">{editFieldErrors.title}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Body *</label>
        <textarea value={editBody} onChange={(e) => onBodyChange(e.target.value)} rows={4} className={`border rounded px-3 py-2 text-sm w-full ${editFieldErrors.body ? 'border-red-500' : 'border-gray-300'}`} />
        {editFieldErrors.body && <p className="text-red-600 text-xs mt-1">{editFieldErrors.body}</p>}
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={editMutationPending} className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {editMutationPending ? 'Saving...' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className="text-gray-600 text-sm hover:underline">Cancel</button>
      </div>
    </form>
  );
}
