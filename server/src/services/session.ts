import crypto from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { sessions, users } from '../db/schema.ts';

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface UserSession {
  session: SessionRow;
  user: { id: string; email: string; emailVerifiedAt: Date | null };
}

const TTL_MS = (Number(process.env.SESSION_TTL_HOURS) || 168) * 60 * 60 * 1000;

export function generateSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(
  db: ReturnType<typeof drizzle>,
  userId: string,
): Promise<SessionRow> {
  const id = generateSessionId();
  const expiresAt = new Date(Date.now() + TTL_MS);

  return db
    .insert(sessions)
    .values({ id, userId, expiresAt })
    .returning({
      id: sessions.id,
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
      createdAt: sessions.createdAt,
    })
    .then((rows) => rows[0]);
}

export function deleteSession(
  db: ReturnType<typeof drizzle>,
  sessionId: string,
): Promise<void> {
  return db.delete(sessions).where(eq(sessions.id, sessionId)).then(() => undefined);
}

export function findSession(
  db: ReturnType<typeof drizzle>,
  sessionId: string,
): Promise<UserSession | null> {
  return db
    .select({
      session: sessions,
      user: {
        id: users.id,
        email: users.email,
        emailVerifiedAt: users.emailVerifiedAt,
      },
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1)
    .then((rows) => {
      if (rows.length === 0) return null;
      const [row] = rows;
      return {
        session: {
          id: row.session.id,
          userId: row.session.userId,
          expiresAt: row.session.expiresAt,
          createdAt: row.session.createdAt,
        },
        user: {
          id: row.user.id,
          email: row.user.email,
          emailVerifiedAt: row.user.emailVerifiedAt,
        },
      };
    });
}
