import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createTeamSchema, renameTeamSchema } from '@kickit/shared';
import { requireSession } from '../plugins/session.ts';
import { users, teams } from '../db/schema.ts';
import { listTeams, createTeam, renameTeam, checkDeleteTeam } from '../services/team.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof drizzle>;
    pool: import('pg').Pool;
  }
}

function getDb(request: FastifyRequest) {
  return request.server.db;
}

export default async function registerTeams(app: FastifyInstance) {
  app.get('/teams', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const teams = await listTeams(getDb(request));
    return reply.code(200).send(teams);
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

    try {
      const team = await createTeam(getDb(request), request.server.pool, parseResult.data.name);
      return reply.code(201).send(team);
    } catch (err: unknown) {
      const pgErr = err instanceof Error && 'cause' in err ? (err as Error & { cause: Error }).cause : err;
      if (pgErr instanceof Error && (pgErr as NodeJS.ErrnoException).code === '23505') {
        return reply.code(409).send({ error: { code: 'TEAM_EXISTS', message: 'Team name already exists' } });
      }
      throw err;
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

    try {
      const result = await renameTeam(getDb(request), teamId, parseResult.data.name);

      if (result === null) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Team not found' } });
      }

      return reply.code(200).send(result);
    } catch (err: unknown) {
      const pgErr = err instanceof Error && 'cause' in err ? (err as Error & { cause: Error }).cause : err;
      if (pgErr instanceof Error && (pgErr as NodeJS.ErrnoException).code === '23505') {
        return reply.code(409).send({ error: { code: 'TEAM_EXISTS', message: 'Team name already exists' } });
      }
      throw err;
    }
  });

  app.delete('/teams/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const teamId = (request.params as Record<string, string>).id;
    const db = getDb(request);

    // Verify team exists before checking counts
    const existing = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .then((rows: Array<{ id: string }>) => rows[0]);

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

    await db.delete(teams).where(eq(teams.id, teamId));
    return reply.code(204).send();
  });
}
