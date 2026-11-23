import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
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

export interface CommentRow {
  id: string;
  body: string;
  authorId: string;
  authorEmail: string;
  createdAt: Date;
}

export async function listTickets(
  db: ReturnType<typeof drizzle>,
  teamId: string,
): Promise<Array<TicketRow>> {
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
    .where(eq(tickets.teamId, teamId))
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
): Promise<TicketRow> {
  const row = await db
    .insert(tickets)
    .values({ teamId, type, state, epicId, title, body, createdBy } as any)
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
  newState: string | undefined,
): Promise<TicketRow | null> {
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

  if (!current) return null;

  // Normalize: treat undefined as "not provided" for diffing
  const normalizedTitle = newTitle !== undefined ? newTitle : undefined;
  const normalizedBody = newBody !== undefined ? newBody : undefined;
  const normalizedEpicId = newEpicId !== undefined ? newEpicId : undefined;
  const normalizedTeamId = newTeamId !== undefined ? newTeamId : undefined;

  // No-op diff: exact equality after normalization
  const isTypeSame = newType === undefined || current.type === newType;
  const isTeamSame = normalizedTeamId === undefined || current.teamId === normalizedTeamId;
  const isEpicSame = normalizedEpicId === undefined || current.epicId === normalizedEpicId;
  const isTitleSame = normalizedTitle === undefined || current.title === normalizedTitle;
  const isBodySame = normalizedBody === undefined || current.body === normalizedBody;
  const isStateSame = newState === undefined || current.state === newState;

  if (isTypeSame && isTeamSame && isEpicSame && isTitleSame && isBodySame && isStateSame) {
    // No change: return current row with extras
    const [teamRow, epicRow, userRow] = await Promise.all([
      db.select({ name: teams.name }).from(teams).where(eq(teams.id, current.teamId)).limit(1).then((r) => r[0]),
      current.epicId ? db.select({ title: epics.title }).from(epics).where(eq(epics.id, current.epicId)).limit(1).then((r) => r[0] ?? null) : Promise.resolve(null),
      db.select({ email: users.email }).from(users).where(eq(users.id, current.createdBy)).limit(1).then((r) => r[0]),
    ]);

    return {
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
    };
  }

  // Build update set
  const updateSet: Record<string, unknown> = {};
  if (newType !== undefined) updateSet.type = newType;
  if (normalizedTeamId !== undefined) updateSet.teamId = normalizedTeamId;
  if (normalizedEpicId !== undefined) updateSet.epicId = normalizedEpicId;
  if (normalizedTitle !== undefined) updateSet.title = normalizedTitle;
  if (normalizedBody !== undefined) updateSet.body = normalizedBody;
  if (newState !== undefined) updateSet.state = newState;
  updateSet.modifiedAt = new Date();

  const row = await db
    .update(tickets)
    .set(updateSet as Record<string, unknown>)
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
  };
}

export async function deleteTicket(
  db: ReturnType<typeof drizzle>,
  ticketId: string,
): Promise<boolean> {
  await db.delete(tickets).where(eq(tickets.id, ticketId));
  return true;
}
