import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, type SQL } from 'drizzle-orm';
import { tickets, users, comments } from '../db/schema.ts';

export interface CommentRow {
  id: string;
  ticketId: string;
  body: string;
  authorId: string;
  authorEmail: string;
  createdAt: Date;
}

export async function addComment(
  db: ReturnType<typeof drizzle>,
  ticketId: string,
  authorId: string,
  body: string,
): Promise<CommentRow> {
  const row = await db
    .insert(comments)
    .values({ ticketId, authorId, body } as typeof comments.$inferInsert)
    .returning({
      id: comments.id,
      ticketId: comments.ticketId,
      body: comments.body,
      authorId: comments.authorId,
      createdAt: comments.createdAt,
    })
    .then((r) => r[0]);

  const authorRow = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, authorId))
    .limit(1)
    .then((r) => r[0]);

  return {
    id: row.id,
    ticketId,
    body: row.body,
    authorId: row.authorId,
    authorEmail: (authorRow?.email as string) ?? '',
    createdAt: row.createdAt,
  };
}

export async function listCommentsForTicket(
  db: ReturnType<typeof drizzle>,
  ticketId: string,
): Promise<Array<CommentRow>> {
  const rawComments = await db
    .select({
      id: comments.id,
      ticketId: comments.ticketId,
      body: comments.body,
      authorId: comments.authorId,
      authorEmail: users.email,
      createdAt: comments.createdAt,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.ticketId, ticketId))
    .orderBy(comments.createdAt);

  return rawComments.map((c) => ({
    ...c,
    ticketId: (c.ticketId as string),
    authorEmail: (c.authorEmail as string) ?? '',
  }));
}
