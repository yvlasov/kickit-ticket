import { type FastifyInstance, type FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTicketSchema, editTicketSchema, addCommentSchema, boardFiltersSchema } from '@kickit/shared';
import { requireSession } from '../plugins/session.ts';
import { tickets } from '../db/schema.ts';
import { listTickets, createTicket, getTicket, editTicket, deleteTicket, addComment } from '../services/ticket.ts';
import { findTeamById } from '../services/epic.ts';

function getDb(request: FastifyRequest) {
  return request.server.db;
}

export default async function registerTickets(app: FastifyInstance) {
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

    const db = getDb(request);
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

    // Validate team exists
    const team = await findTeamById(getDb(request), teamId);
    if (!team) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
    }

    const normalizedEpicId = epicId ?? null;
    const result = await createTicket(getDb(request), request.server.pool, teamId, type, normalizedState, normalizedEpicId, title, body, request.user.id);
    if (result.kind === 'error') {
      return reply.code(400).send({ error: { code: result.code, message: result.message } });
    }
    return reply.code(201).send(result.ticket);
  });

  app.get('/tickets/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const ticketId = (request.params as Record<string, string>).id;

    const result = await getTicket(getDb(request), ticketId);

    if (!result.ticket) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }

    return reply.code(200).send({ ticket: result.ticket, comments: result.comments });
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

    const db = getDb(request);
    // Verify ticket exists
    const existing = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).limit(1).then((r: Array<{ id: string }>) => r[0]);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }

    const comment = await addComment(db, ticketId, request.user.id, parseResult.data.body);
    return reply.code(201).send(comment);
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

    // Validate new team exists if provided
    if (newTeamId !== undefined) {
      const newTeam = await findTeamById(getDb(request), newTeamId);
      if (!newTeam) {
        return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: 'Unknown teamId' } });
      }
    }

    const result = await editTicket(getDb(request), request.server.pool, ticketId, newType, newTeamId, newEpicId, newTitle, newBody, newState);

    if (result.kind === 'error') {
      return reply.code(400).send({ error: { code: result.code, message: result.message } });
    }

    if (result.kind === 'ok' && result.ticket === null) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }

    return reply.code(200).send(result.ticket);
  });

  app.delete('/tickets/:id', async (request, reply) => {
    await requireSession(request, reply);
    if (request.user === null) return;

    const ticketId = (request.params as Record<string, string>).id;
    const db = getDb(request);

    // Verify ticket exists
    const existing = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, ticketId)).limit(1).then((r: Array<{ id: string }>) => r[0]);
    if (!existing) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ticket not found' } });
    }

    await deleteTicket(db, ticketId);
    return reply.code(204).send();
  });
}
