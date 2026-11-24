import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { createEpicSchema, editEpicSchema } from '@kickit/shared';
import { requireSession } from '../plugins/session.ts';
import { epics } from '../db/schema.ts';
import { listEpics, createEpic, editEpic, checkDeleteEpic, findTeamById } from '../services/epic.ts';

function getDb(request: FastifyRequest) {
  return request.server.db;
}

export default async function registerEpics(app: FastifyInstance) {
  app.get('/epics', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const searchParams = new URL(request.url, `http://${request.headers.host}`).searchParams;
    const teamId = searchParams.get('teamId');

    if (teamId !== null) {
      const isValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(teamId);
      if (!isValid) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Invalid teamId format' } });
      }
    }

    const epics = await listEpics(getDb(request), teamId ?? undefined);
    return reply.code(200).send(epics);
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

    // Validate team exists
    const team = await findTeamById(getDb(request), teamId);
    if (!team) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
    }

    const epic = await createEpic(getDb(request), request.server.pool, teamId, title, normalizedDesc);
    return reply.code(201).send(epic);
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

    const result = await editEpic(getDb(request), epicId, title, normalizedDesc);

    if (result === null) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Epic not found' } });
    }

    return reply.code(200).send(result);
  });

  app.delete('/epics/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const epicId = (request.params as Record<string, string>).id;
    const db = getDb(request);

    // Verify epic exists before checking counts
    const existing = await db
      .select({ id: epics.id })
      .from(epics)
      .where(eq(epics.id, epicId))
      .limit(1)
      .then((rows: Array<{ id: string }>) => rows[0]);

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

    await db.delete(epics).where(eq(epics.id, epicId));
    return reply.code(204).send();
  });
}
