import { type FormEvent } from 'react';
import { type EpicRow } from '../hooks/useEpics';

interface EpicRowProps {
  epic: EpicRow;
  teamName: string | undefined;
  editingId: string | null;
  editingTitle: string;
  editingDescription: string;
  editFieldErrors: Record<string, string>;
  editError: string | null;
  deletePending: boolean;
  onEdit: () => void;
  onSave: (e: FormEvent, epicId: string) => void;
  onCancel: () => void;
  onDelete: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  editMutationPending: boolean;
  deleteMutationPending: boolean;
}

export function EpicRowComponent({
  epic,
  teamName,
  editingId,
  editingTitle,
  editingDescription,
  editFieldErrors,
  editError,
  deletePending,
  onEdit,
  onSave,
  onCancel,
  onDelete,
  onTitleChange,
  onDescriptionChange,
  editMutationPending,
  deleteMutationPending,
}: EpicRowProps): JSX.Element {
  const isEditing = editingId === epic.id;

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-2">
        {isEditing ? (
          <form onSubmit={(e) => onSave(e, epic.id)} className="space-y-1">
            <input
              type="text"
              value={editingTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className={`border rounded px-2 py-1 text-sm w-full ${editFieldErrors.title ? 'border-red-500' : 'border-gray-300'}`}
            />
            {editFieldErrors.title && <p className="text-red-600 text-xs">{editFieldErrors.title}</p>}
            <textarea
              value={editingDescription}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Description"
              rows={2}
              className="border rounded px-2 py-1 text-sm w-full border-gray-300"
            />
            <div className="flex gap-1">
              <button
                type="submit"
                disabled={editMutationPending}
                className="text-green-600 text-sm hover:underline disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                onClick={onCancel}
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
        {editError && isEditing && (
          <p className="text-red-600 text-xs mt-1">{editError}</p>
        )}
      </td>
      <td className="px-4 py-2 text-sm">
        {isEditing ? (
          <input
            type="text"
            value={teamName ?? ''}
            disabled
            className="border rounded px-2 py-1 text-sm w-full bg-gray-100 text-gray-500 border-gray-300"
          />
        ) : (
          <span className="text-gray-700">{teamName ?? '?'}</span>
        )}
      </td>
      <td className="px-4 py-2 text-sm">{epic.ticketCount}</td>
      <td className="px-4 py-2 text-sm text-gray-600">{epic.modifiedAt}</td>
      <td className="px-4 py-2 text-right">
        {!isEditing && (
          <>
            <button
              onClick={onEdit}
              className="text-blue-600 text-sm hover:underline mr-3"
              disabled={deletePending}
            >
              Edit
            </button>
            <button
              onClick={onDelete}
              disabled={deleteMutationPending || epic.ticketCount > 0}
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
  );
}
