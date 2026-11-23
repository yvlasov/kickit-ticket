import { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { type UserSession } from '../services/session.ts';
import { findSession } from '../services/session.ts';

interface SessionUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser;
  }
}

export async function sessionGuardPlugin(app: FastifyInstance, _opts: unknown): Promise<void> {
  app.decorateRequest('user', null as unknown as SessionUser);
}

export async function requireSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cookieName = process.env.SESSION_COOKIE_NAME || 'kickit_session';
  const sessionId = request.cookies[cookieName];

  if (!sessionId) {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session required' } });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  try {
    const result: UserSession | null = await findSession(db, sessionId);

    if (!result) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid session' } });
    }

    if (result.session.expiresAt < new Date()) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Session expired' } });
    }

    if (result.user.emailVerifiedAt === null) {
      return reply.code(403).send({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } });
    }

    request.user = {
      id: result.user.id,
      email: result.user.email,
      emailVerifiedAt: result.user.emailVerifiedAt,
    };
  } finally {
    await pool.end();
  }
}
