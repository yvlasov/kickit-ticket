import { type FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { signupSchema, verifySchema, resendSchema, loginSchema } from '@kickit/shared';
import { signup, verifyToken, resendVerification, verifyPassword } from './services/auth.ts';
import { createSession, deleteSession } from './services/session.ts';
import { requireSession } from './plugins/session.ts';
import { users } from './db/schema.ts';

export default async function routes(app: FastifyInstance) {
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  app.get('/readiness', async (_request, reply) => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(503).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }
    try {
      const pool = new Pool({ connectionString: url });
      await pool.query('SELECT 1');
      await pool.end();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ error: { code: 'UNREACHABLE', message: 'Database not reachable' } });
    }
  });

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

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      await signup(db, pool, email, password);
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

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const result = await verifyToken(db, parseResult.data.token);
      return reply.code(200).send({ status: result });
    } finally {
      await pool.end();
    }
  });

  app.post('/auth/resend-verification', async (request, reply) => {
    const parseResult = resendSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      await resendVerification(db, parseResult.data.email);
      return reply.code(202).send({ message: 'Verification email sent' });
    } finally {
      await pool.end();
    }
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

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const userRow = await db
        .select({ id: users.id, email: users.email, passwordHash: users.passwordHash, emailVerifiedAt: users.emailVerifiedAt })
        .from(users)
        .where(users.email === email)
        .limit(1)
        .then((rows) => rows[0]);

      if (!userRow || !(await verifyPassword(userRow.passwordHash, password))) {
        return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
      }

      if (userRow.emailVerifiedAt === null) {
        return reply.code(403).send({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' } });
      }

      const session = await createSession(db, userRow.id);

      const isHttps = (process.env.PUBLIC_BASE_URL || '').startsWith('https://');

      reply.setCookie(process.env.SESSION_COOKIE_NAME || 'kickit_session', session.id, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isHttps,
        expires: session.expiresAt,
      });

      return reply.code(200).send({ id: userRow.id, email: userRow.email });
    } finally {
      await pool.end();
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const cookieName = process.env.SESSION_COOKIE_NAME || 'kickit_session';
    const sessionId = request.cookies[cookieName];

    if (sessionId) {
      const url = process.env.DATABASE_URL;
      if (url) {
        const pool = new Pool({ connectionString: url });
        const db = drizzle(pool);
        try {
          await deleteSession(db, sessionId);
        } finally {
          await pool.end();
        }
      }
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
