import { type FastifyInstance } from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { Pool } from 'pg';
import { signupSchema, verifySchema, resendSchema, loginSchema, createTeamSchema, renameTeamSchema, createEpicSchema, editEpicSchema, createTicketSchema, editTicketSchema, addCommentSchema, boardFiltersSchema } from '@kickit/shared';
import { signup, verifyToken, resendVerification, verifyPassword } from './services/auth.ts';
import { createSession, deleteSession } from './services/session.ts';
import { requireSession } from './plugins/session.ts';
import { users, teams, epics, tickets } from './db/schema.ts';
import { listTeams, createTeam, renameTeam, checkDeleteTeam } from './services/team.ts';
import { listEpics, createEpic, editEpic, checkDeleteEpic, findTeamById, listTeams as listEpicTeams } from './services/epic.ts';
import { listTickets, createTicket, getTicket, editTicket, deleteTicket, addComment } from './services/ticket.ts';

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
        .where(eq(users.email, email))
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

  // ---- Team routes ----

  app.get('/teams', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const teams = await listTeams(db);
      return reply.code(200).send(teams);
    } finally {
      await pool.end();
    }
  });

  app.post('/teams', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const parseResult = createTeamSchema.safeParse(request.body);
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
      const team = await createTeam(db, pool, parseResult.data.name);
      return reply.code(201).send(team);
    } catch (err: unknown) {
      const pgErr = err instanceof Error && 'cause' in err ? (err as Error & { cause: Error }).cause : err;
      if (pgErr instanceof Error && (pgErr as NodeJS.ErrnoException).code === '23505') {
        return reply.code(409).send({ error: { code: 'TEAM_EXISTS', message: 'Team name already exists' } });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  app.patch('/teams/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const teamId = (request.params as Record<string, string>).id;

    const parseResult = renameTeamSchema.safeParse(request.body);
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
      const result = await renameTeam(db, teamId, parseResult.data.name);

      if (result === null) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      }

      // Check if the update was a duplicate (another team now has this name)
      // This shouldn't happen since we do the update atomically, but handle 409 if citext conflict
      return reply.code(200).send(result);
    } catch (err: unknown) {
      const pgErr = err instanceof Error && 'cause' in err ? (err as Error & { cause: Error }).cause : err;
      if (pgErr instanceof Error && (pgErr as NodeJS.ErrnoException).code === '23505') {
        return reply.code(409).send({ error: { code: 'TEAM_EXISTS', message: 'Team name already exists' } });
      }
      throw err;
    } finally {
      await pool.end();
    }
  });

  app.delete('/teams/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const teamId = (request.params as Record<string, string>).id;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      // Verify team exists before checking counts
      const existing = await db
        .select({ id: teams.id })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      }

      const counts = await checkDeleteTeam(db, teamId);

      if (counts.hasTickets > 0 || counts.hasEpics > 0) {
        const reasons: string[] = [];
        if (counts.hasEpics > 0) reasons.push(`${counts.hasEpics} epic(s)`);
        if (counts.hasTickets > 0) reasons.push(`${counts.hasTickets} ticket(s)`);
        return reply.code(409).send({
          error: {
            code: 'TEAM_NOT_EMPTY',
            message: `Cannot delete team: referenced by ${reasons.join(' and ')}`,
          },
        });
      }

      // Delete the team
      await db.delete(teams).where(eq(teams.id, teamId));
      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // ---- Epic routes ----

  app.get('/epics', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
      const teamId = searchParams.get('teamId');

      if (teamId !== null) {
        const isValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId);
        if (!isValid) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid teamId format' } });
        }
      }

      const epics = await listEpics(db, teamId ?? undefined);
      return reply.code(200).send(epics);
    } finally {
      await pool.end();
    }
  });

  app.post('/epics', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const parseResult = createEpicSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.filter((p): p is string => typeof p === 'string').join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const { teamId, title, description } = parseResult.data;
    const normalizedDesc = description ?? null;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      // Validate team exists
      const team = await findTeamById(db, teamId);
      if (!team) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
      }

      const epic = await createEpic(db, pool, teamId, title, normalizedDesc);
      return reply.code(201).send(epic);
    } finally {
      await pool.end();
    }
  });

  app.patch('/epics/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const epicId = (request.params as Record<string, string>).id;

    const parseResult = editEpicSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.filter((p): p is string => typeof p === 'string').join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const { title, description } = parseResult.data;
    const normalizedDesc = description ?? null;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const result = await editEpic(db, epicId, title, normalizedDesc);

      if (result === null) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Epic not found' } });
      }

      return reply.code(200).send(result);
    } finally {
      await pool.end();
    }
  });

  app.delete('/epics/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const epicId = (request.params as Record<string, string>).id;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      // Verify epic exists before checking counts
      const existing = await db
        .select({ id: epics.id })
        .from(epics)
        .where(eq(epics.id, epicId))
        .limit(1)
        .then((rows) => rows[0]);

      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Epic not found' } });
      }

      const counts = await checkDeleteEpic(db, epicId);

      if (counts.ticketCount > 0) {
        return reply.code(409).send({
          error: {
            code: 'EPIC_NOT_EMPTY',
            message: `Cannot delete epic: referenced by ${counts.ticketCount} ticket(s)`,
          },
        });
      }

      // Delete the epic
      await db.delete(epics).where(eq(epics.id, epicId));
      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });

  // ---- Ticket routes ----

  app.get('/tickets', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const teamId = searchParams.get('teamId');
    const type = searchParams.get('type');
    const epic = searchParams.get('epic');
    const q = searchParams.get('q');

    if (!teamId) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'teamId query parameter is required' } });
    }

    const isValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId);
    if (!isValid) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid teamId format' } });
    }

    // Verify team exists
    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const team = await findTeamById(db, teamId);
      if (!team) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
      }

      // Validate filters
      const filterResult = boardFiltersSchema.safeParse({ type: type ?? undefined, epic: epic ?? undefined, q: q ?? undefined });
      if (!filterResult.success) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid filter parameter', details: filterResult.error.errors.map((e: { path: Array<unknown>; message: string }) => ({ field: e.path.join('.'), message: e.message })) } });
      }

      const filters = filterResult.data;
      const tickets = await listTickets(db, teamId, filters);
      return reply.code(200).send(tickets);
    } finally {
      await pool.end();
    }
  });

  app.post('/tickets', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const parseResult = createTicketSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.filter((p): p is string => typeof p === 'string').join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const { teamId, type, state, epicId, title, body } = parseResult.data;
    const normalizedState = state ?? 'new';

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      // Validate team exists
      const team = await findTeamById(db, teamId);
      if (!team) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
      }

      // Validate epic if present must belong to team
      if (epicId !== null && epicId !== undefined) {
        const epicTeam = await db.select({ teamId: epics.teamId }).from(epics).where(eq(epics.id, epicId)).limit(1).then((r) => r[0]);
        if (!epicTeam || epicTeam.teamId !== teamId) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Epic does not belong to the specified team' } });
        }
      }

      const normalizedEpicId = epicId ?? null;
      const ticket = await createTicket(db, pool, teamId, type, normalizedState, normalizedEpicId, title, body, request.user.id);
      return reply.code(201).send(ticket);
    } finally {
      await pool.end();
    }
  });

  app.get('/tickets/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const ticketId = (request.params as Record<string, string>).id;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      const result = await getTicket(db, ticketId);

      if (!result.ticket) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      return reply.code(200).send({ ticket: result.ticket, comments: result.comments });
    } finally {
      await pool.end();
    }
  });

  app.post('/tickets/:id/comments', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const ticketId = (request.params as Record<string, string>).id;

    const parseResult = addCommentSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.filter((p): p is string => typeof p === 'string').join('.'),
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
      // Verify ticket exists
      const existing = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).limit(1).then((r) => r[0]);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      const comment = await addComment(db, ticketId, request.user.id, parseResult.data.body);
      return reply.code(201).send(comment);
    } finally {
      await pool.end();
    }
  });

  app.patch('/tickets/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const ticketId = (request.params as Record<string, string>).id;

    const parseResult = editTicketSchema.safeParse(request.body);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => ({
        field: e.path.filter((p): p is string => typeof p === 'string').join('.'),
        message: e.message,
      }));
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details } });
    }

    const { type: newType, teamId: newTeamId, epicId: newEpicId, title: newTitle, body: newBody, state: newState } = parseResult.data;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      // Verify ticket exists
      const existing = await db.select({ id: tickets.id, teamId: tickets.teamId }).from(tickets).where(eq(tickets.id, ticketId)).limit(1).then((r) => r[0]);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      // Validate epic if present: must belong to the (new or current) team
      if (newEpicId !== null && newEpicId !== undefined) {
        const targetTeamId = newTeamId ?? existing.teamId;
        const epicTeam = await db.select({ teamId: epics.teamId }).from(epics).where(eq(epics.id, newEpicId)).limit(1).then((r) => r[0]);
        if (!epicTeam || epicTeam.teamId !== targetTeamId) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Epic does not belong to the specified team' } });
        }
      }

      // Validate new team exists if provided
      if (newTeamId !== undefined) {
        const newTeam = await findTeamById(db, newTeamId);
        if (!newTeam) {
          return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
        }
      }

      // Team change rules: if team changes and epicId not supplied, auto-null epic
      const effectiveEpicId = (newTeamId !== undefined && newTeamId !== existing.teamId && newEpicId === undefined) ? null : newEpicId;

      const result = await editTicket(db, pool, ticketId, newType, newTeamId, effectiveEpicId, newTitle, newBody, newState);

      if (result === null) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      return reply.code(200).send(result);
    } finally {
      await pool.end();
    }
  });

  app.delete('/tickets/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const ticketId = (request.params as Record<string, string>).id;

    const url = process.env.DATABASE_URL;
    if (!url) {
      return reply.code(500).send({ error: { code: 'NOT_CONFIGURED', message: 'DATABASE_URL not set' } });
    }

    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);

    try {
      // Verify ticket exists
      const existing = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).limit(1).then((r) => r[0]);
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
      }

      await deleteTicket(db, ticketId);
      return reply.code(204).send();
    } finally {
      await pool.end();
    }
  });
}
