import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import { Pool } from 'pg';
import { tickets, teams, users, epics, comments } from '../db/schema.ts';

export interface TicketRow {
  id: string;
  teamId: string;
  type: string;
  state: string;
  epicId: string | null;
  epicTitle: string | null;
  title: string;
  body: string | null;
  createdBy: string;
  createdByEmail: string;
  createdAt: Date;
  modifiedAt: Date;
  teamName: string;
}

export type EditTicketResult =
  | { kind: 'ok'; ticket: TicketRow }
  | { kind: 'error'; code: string; message: string };

export type CreateTicketResult =
  | { kind: 'ok'; ticket: TicketRow }
  | { kind: 'error'; code: string; message: string };

export interface CommentRow {
  id: string;
  ticketId: string;
  body: string;
  authorId: string;
  authorEmail: string;
  createdAt: Date;
}

export interface ListTicketsFilters {
  type?: string;
  epic?: 'none' | string;
  q?: string;
}

export async function listTickets(
  db: ReturnType<typeof drizzle>,
  teamId: string,
  filters?: ListTicketsFilters,
): Promise<Array<TicketRow>> {
  const conditions: Array<SQL> = [eq(tickets.teamId, teamId)];

  if (filters?.type !== undefined) {
    conditions.push(eq(tickets.type, filters.type));
  }

  if (filters?.epic !== undefined) {
    if (filters.epic === 'none') {
      conditions.push(sql`${tickets.epicId} IS NULL`);
    } else {
      conditions.push(eq(tickets.epicId, filters.epic));
    }
  }

  if (filters?.q !== undefined && filters.q.length > 0) {
    const escaped = filters.q.replace(/([%_\\])/g, '\\$1');
    conditions.push(sql`LOWER(${tickets.title}) LIKE LOWER(${`%${escaped}%`}) ESCAPE '\\'`);
  }

  const rows = await db
    .select({
      id: tickets.id,
      teamId: tickets.teamId,
      type: tickets.type,
      state: tickets.state,
      epicId: tickets.epicId,
      epicTitle: epics.title,
      title: tickets.title,
      body: sql<string>`COALESCE(${tickets.body}, '')`,
      createdBy: tickets.createdBy,
      createdByEmail: users.email,
      createdAt: tickets.createdAt,
      modifiedAt: tickets.modifiedAt,
      teamName: teams.name,
    })
    .from(tickets)
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .leftJoin(users, eq(users.id, tickets.createdBy))
    .leftJoin(epics, eq(epics.id, tickets.epicId))
    .where(and(...conditions))
    .orderBy(sql`${tickets.modifiedAt} DESC, ${tickets.id} DESC`);

  return rows.map((r) => ({
    ...r,
    createdByEmail: (r.createdByEmail as string) ?? '',
    teamName: (r.teamName as string) ?? '',
    epicTitle: (r.epicTitle as string) ?? null,
  })) as Array<TicketRow>;
}

export async function createTicket(
  db: ReturnType<typeof drizzle>,
  pool: Pool,
  teamId: string,
  type: string,
  state: string,
  epicId: string | null,
  title: string,
  body: string | null,
  createdBy: string,
): Promise<CreateTicketResult> {
  // Epic-team validation: if epic is supplied, it must belong to the team
  if (epicId !== null && epicId !== undefined) {
    const epicTeam = await db
      .select({ teamId: epics.teamId })
      .from(epics)
      .where(eq(epics.id, epicId))
      .limit(1)
      .then((r) => r[0]);
    if (!epicTeam || epicTeam.teamId !== teamId) {
      return { kind: 'error', code: 'VALIDATION_ERROR', message: 'Epic does not belong to the specified team' };
    }
  }

  const row = await db
    .insert(tickets)
    .values({ teamId, type, state, epicId, title, body, createdBy } as typeof tickets.$inferInsert)
    .returning({
      id: tickets.id,
      teamId: tickets.teamId,
      type: tickets.type,
      state: tickets.state,
      epicId: tickets.epicId,
      title: tickets.title,
      body: tickets.body,
      createdBy: tickets.createdBy,
      createdAt: tickets.createdAt,
      modifiedAt: tickets.modifiedAt,
    })
    .then((rows) => rows[0]);

  const [teamRow, epicRow, userRow] = await Promise.all([
    db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1).then((r) => r[0]),
    epicId ? db.select({ title: epics.title }).from(epics).where(eq(epics.id, epicId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
    db.select({ email: users.email }).from(users).where(eq(users.id, createdBy)).limit(1).then((r) => r[0]),
  ]);

  return {
    kind: 'ok',
    ticket: {
      id: row.id,
      teamId: row.teamId,
      type: row.type,
      state: row.state,
      epicId: row.epicId,
      epicTitle: epicRow?.title ?? null,
      title: row.title,
      body: row.body,
      createdBy: row.createdBy,
      createdByEmail: userRow?.email ?? '',
      createdAt: row.createdAt,
      modifiedAt: row.modifiedAt,
      teamName: teamRow?.name ?? '',
    },
  };
}

export async function getTicket(
  db: ReturnType<typeof drizzle>,
  ticketId: string,
): Promise<{ ticket: TicketRow | null; comments: Array<CommentRow> }> {
  const ticketRows = await db
    .select({
      id: tickets.id,
      teamId: tickets.teamId,
      type: tickets.type,
      state: tickets.state,
      epicId: tickets.epicId,
      epicTitle: epics.title,
      title: tickets.title,
      body: tickets.body,
      createdBy: tickets.createdBy,
      createdByEmail: users.email,
      createdAt: tickets.createdAt,
      modifiedAt: tickets.modifiedAt,
      teamName: teams.name,
    })
    .from(tickets)
    .leftJoin(teams, eq(teams.id, tickets.teamId))
    .leftJoin(users, eq(users.id, tickets.createdBy))
    .leftJoin(epics, eq(epics.id, tickets.epicId))
    .where(eq(tickets.id, ticketId))
    .limit(1);

  const ticket = ticketRows[0]
    ? {
        ...ticketRows[0],
        createdByEmail: (ticketRows[0].createdByEmail as string) ?? '',
        teamName: (ticketRows[0].teamName as string) ?? '',
        epicTitle: (ticketRows[0].epicTitle as string) ?? null,
      }
    : null;

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

  const resultComments: Array<CommentRow> = rawComments.map((c) => ({
    ...c,
    ticketId: (c.ticketId as string),
    authorEmail: (c.authorEmail as string) ?? '',
  }));

  return { ticket, comments: resultComments };
}

export async function editTicket(
  db: ReturnType<typeof drizzle>,
  pool: Pool,
  ticketId: string,
  newType: string | undefined,
  newTeamId: string | undefined,
  newEpicId: string | null | undefined,
  newTitle: string | undefined,
  newBody: string | null | undefined,
  newState: 'new' | 'ready_for_implementation' | 'in_progress' | 'ready_for_acceptance' | 'done' | undefined,
): Promise<EditTicketResult> {
  const current = await db
    .select({
      id: tickets.id,
      teamId: tickets.teamId,
      type: tickets.type,
      state: tickets.state,
      epicId: tickets.epicId,
      title: tickets.title,
      body: tickets.body,
      createdBy: tickets.createdBy,
      createdAt: tickets.createdAt,
      modifiedAt: tickets.modifiedAt,
    })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!current) return { kind: 'error', code: 'NOT_FOUND', message: 'Ticket not found' };

  // Determine target team for epic validation
  const targetTeamId = newTeamId ?? current.teamId;

  // Team-change epic auto-null: if team changes and epicId not supplied, null it
  const effectiveEpicId =
    (newTeamId !== undefined && newTeamId !== current.teamId && newEpicId === undefined)
      ? null
      : newEpicId;

  // Epic-team validation: if epic is supplied (after auto-null), it must belong to target team
  if (effectiveEpicId !== undefined && effectiveEpicId !== null) {
    const epicTeam = await db
      .select({ teamId: epics.teamId })
      .from(epics)
      .where(eq(epics.id, effectiveEpicId))
      .limit(1)
      .then((r) => r[0]);
    if (!epicTeam || epicTeam.teamId !== targetTeamId) {
      return { kind: 'error', code: 'VALIDATION_ERROR', message: 'Epic does not belong to the specified team' };
    }
  }

  // Normalize: treat undefined as "not provided" for diffing; trim title/body in service per spec
  const normalizedTitle = newTitle !== undefined ? newTitle.trim() : undefined;
  const normalizedBody = newBody !== undefined ? (newBody === null ? null : newBody.trim()) : undefined;
  const normalizedEpicId = effectiveEpicId !== undefined ? effectiveEpicId : undefined;
  const normalizedTeamId = newTeamId !== undefined ? newTeamId : undefined;

  // No-op diff: exact equality after normalization
  const isTypeSame = newType === undefined || current.type === newType;
  const isTeamSame = normalizedTeamId === undefined || current.teamId === normalizedTeamId;
  const isEpicSame = normalizedEpicId === undefined || current.epicId === normalizedEpicId;
  const isTitleSame = normalizedTitle === undefined || current.title === normalizedTitle;
  const isBodySame = normalizedBody === undefined || normalizedBody === null || current.body === normalizedBody;
  const isStateSame = newState === undefined || current.state === newState;

  if (isTypeSame && isTeamSame && isEpicSame && isTitleSame && isBodySame && isStateSame) {
    // No change: return current row with extras
    const [teamRow, epicRow, userRow] = await Promise.all([
      db.select({ name: teams.name }).from(teams).where(eq(teams.id, current.teamId)).limit(1).then((r) => r[0]),
      current.epicId ? db.select({ title: epics.title }).from(epics).where(eq(epics.id, current.epicId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
      db.select({ email: users.email }).from(users).where(eq(users.id, current.createdBy)).limit(1).then((r) => r[0]),
    ]);

    return {
      kind: 'ok',
      ticket: {
        id: current.id,
        teamId: current.teamId,
        type: current.type,
        state: current.state,
        epicId: current.epicId,
        epicTitle: epicRow?.title ?? null,
        title: current.title,
        body: current.body,
        createdBy: current.createdBy,
        createdByEmail: userRow?.email ?? '',
        createdAt: current.createdAt,
        modifiedAt: current.modifiedAt,
        teamName: teamRow?.name ?? '',
      },
    };
  }

  // Build update set
  const updateSet: Partial<typeof tickets.$inferInsert> = {};
  if (newType !== undefined) updateSet.type = newType;
  if (normalizedTeamId !== undefined) updateSet.teamId = normalizedTeamId;
  if (normalizedEpicId !== undefined) updateSet.epicId = normalizedEpicId;
  if (normalizedTitle !== undefined) updateSet.title = normalizedTitle;
  if (normalizedBody !== undefined && normalizedBody !== null) updateSet.body = normalizedBody;
  if (newState !== undefined) updateSet.state = newState;
  updateSet.modifiedAt = new Date();

  const row = await db
    .update(tickets)
    .set(updateSet)
    .where(eq(tickets.id, ticketId))
    .returning({
      id: tickets.id,
      teamId: tickets.teamId,
      type: tickets.type,
      state: tickets.state,
      epicId: tickets.epicId,
      title: tickets.title,
      body: tickets.body,
      createdBy: tickets.createdBy,
      createdAt: tickets.createdAt,
      modifiedAt: tickets.modifiedAt,
    })
    .then((rows) => rows[0]);

  const [teamRow, epicRow, userRow] = await Promise.all([
    db.select({ name: teams.name }).from(teams).where(eq(teams.id, row.teamId)).limit(1).then((r) => r[0]),
    row.epicId ? db.select({ title: epics.title }).from(epics).where(eq(epics.id, row.epicId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
    db.select({ email: users.email }).from(users).where(eq(users.id, row.createdBy)).limit(1).then((r) => r[0]),
  ]);

  return {
    kind: 'ok',
    ticket: {
      id: row.id,
      teamId: row.teamId,
      type: row.type,
      state: row.state,
      epicId: row.epicId,
      epicTitle: epicRow?.title ?? null,
      title: row.title,
      body: row.body,
      createdBy: row.createdBy,
      createdByEmail: userRow?.email ?? '',
      createdAt: row.createdAt,
      modifiedAt: row.modifiedAt,
      teamName: teamRow?.name ?? '',
    },
  };
}

export async function deleteTicket(
  db: ReturnType<typeof drizzle>,
  ticketId: string,
): Promise<boolean> {
  await db.delete(tickets).where(eq(tickets.id, ticketId));
  return true;
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
