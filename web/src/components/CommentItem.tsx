import { type CommentRow } from '../hooks/useTicket';
import { formatDate } from '../hooks/useTicket';

interface CommentItemProps {
  comment: CommentRow;
}

export function CommentItem({ comment }: CommentItemProps): JSX.Element {
  return (
    <div className="border-b pb-3 last:border-b-0">
      <div className="text-sm text-gray-500 mb-1">{comment.authorEmail} · {formatDate(comment.createdAt)}</div>
      <div className="text-sm whitespace-pre-wrap">{comment.body}</div>
    </div>
  );
}
