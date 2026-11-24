import { type FormEvent } from 'react';
import { type CommentRow } from '../hooks/useTicket';
import { CommentItem } from './CommentItem';

interface CommentsSectionProps {
  comments: Array<CommentRow>;
  commentBody: string;
  commentApiError: string | null;
  commentMutationPending: boolean;
  onCommentBodyChange: (v: string) => void;
  onCommentSubmit: (e: FormEvent) => void;
}

export function CommentsSection({
  comments, commentBody, commentApiError, commentMutationPending,
  onCommentBodyChange, onCommentSubmit,
}: CommentsSectionProps): JSX.Element {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-lg font-semibold mb-4">Comments</h2>
      {comments.length === 0 ? (
        <p className="text-gray-500 text-sm">No comments yet.</p>
      ) : (
        <div className="space-y-3 mb-4">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </div>
      )}
      <form onSubmit={onCommentSubmit} className="space-y-3">
        <textarea
          value={commentBody}
          onChange={(e) => onCommentBodyChange(e.target.value)}
          placeholder="Add a comment..."
          rows={3}
          className="border rounded px-3 py-2 text-sm w-full border-gray-300"
        />
        {commentApiError && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">{commentApiError}</div>
        )}
        <button
          type="submit"
          disabled={commentMutationPending}
          className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {commentMutationPending ? 'Adding...' : 'Add comment'}
        </button>
      </form>
    </div>
  );
}
