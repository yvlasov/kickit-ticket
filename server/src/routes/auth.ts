import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { signupSchema, verifySchema, resendSchema, loginSchema } from '@kickit/shared';
import { signup, verifyToken, resendVerification, verifyPassword } from '../services/auth.ts';
import { createSession, deleteSession } from '../services/session.ts';
import { requireSession } from '../plugins/session.ts';
import { users, sessions } from '../db/schema.ts';

function getDb(request: FastifyRequest) {
  return request.server.db;
}

export default async function registerAuth(app: FastifyInstance) {
  app.post('/auth/signup', async (request, reply) => {
    const parseResult = signupSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const { email, password } = parseResult.data;

    try {
      await signup(getDb(request), request.server.pool, email, password);
      return reply.code(201).send({ message: 'User created. Check your email for verification.' });
    } catch (err: unknown) {
      const pgErr = err instanceof Error && 'cause' in err ? (err as Error & { cause: Error }).cause : err;
      if (pgErr instanceof Error && (pgErr as NodeJS.ErrnoException).code === '23505') {
        return reply.code(409).send({ error: { code: 'EMAIL_EXISTS', message: 'Email already registered' } });
      }
      throw err;
    }
  });

  app.post('/auth/verify', async (request, reply) => {
    const parseResult = verifySchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const result = await verifyToken(getDb(request), parseResult.data.token);
    return reply.code(200).send({ status: result });
  });

  app.post('/auth/resend-verification', async (request, reply) => {
    // Spec: always 202 — even on zod parse failure, return 202 with same body
    const parseResult = resendSchema.safeParse(request.body);
    if (parseResult.success) {
      await resendVerification(getDb(request), parseResult.data.email);
    }
    return reply.code(202).send({ message: 'Verification email sent' });
  });

  app.post('/auth/login', async (request, reply) => {
    const parseResult = loginSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const { email, password } = parseResult.data;

    const db = getDb(request);
    const userRow = await db
      .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
      .then((rows: Array<{ id: string; email: string; passwordHash: string; emailVerifiedAt: Date | null }>) => rows[0]);

    if (!userRow || !(await verifyPassword(userRow.passwordHash, password))) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    }

    if (userRow.emailVerifiedAt === null) {
      return reply.code(403).send({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } });
    }

    const session = await createSession(db, userRow.id);

    // Opportunistic cleanup: delete expired session rows for all users
    await db.delete(sessions).where(sql`expires_at < now()`);

    const isHttps = (process.env.PUBLIC_BASE_URL || '').startsWith('https://');

    reply.setCookie(process.env.SESSION_COOKIE_NAME || 'kickit_session', session.id, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: isHttps,
      expires: session.expiresAt,
    });

    return reply.code(200).send({ id: userRow.id, email: userRow.email });
  });

  app.post('/auth/logout', async (request, reply) => {
    const cookieName = process.env.SESSION_COOKIE_NAME || 'kickit_session';
    const sessionId = request.cookies[cookieName];

    if (sessionId) {
      await deleteSession(getDb(request), sessionId);
    }

    reply.clearCookie(cookieName, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/auth/me', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;
    return reply.code(200).send({ id: request.user.id, email: request.user.email });
  });
}
