import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { epics, teams, tickets } from '../db/schema.ts';

export interface EpicRow {
  id: string;
  teamId: string;
  title: string;
  description: string | null;
  createdAt: Date;
  modifiedAt: Date;
  ticketCount: number;
}

export interface TeamRow {
  id: string;
  name: string;
}

export async function listEpics(
  db: ReturnType<typeof drizzle>,
  teamId?: string,
): Promise<Array<EpicRow>> {
  const query = db
    .select({
      id: epics.id,
      teamId: epics.teamId,
      title: epics.title,
      description: epics.description,
      createdAt: epics.createdAt,
      modifiedAt: epics.modifiedAt,
      ticketCount: sql<number>`COALESCE((SELECT COUNT(*) FROM tickets WHERE tickets.epic_id = epics.id), 0)::int`,
    })
    .from(epics)
    .orderBy(epics.modifiedAt);

  if (teamId) {
    query.where(eq(epics.teamId, teamId));
  }

  return query;
}

export async function createEpic(
  db: ReturnType<typeof drizzle>,
  pool: Pool,
  teamId: string,
  title: string,
  description: string | null,
): Promise<EpicRow> {
  return db
    .insert(epics)
    .values({ teamId, title, description })
    .returning({
      id: epics.id,
      teamId: epics.teamId,
      title: epics.title,
      description: epics.description,
      createdAt: epics.createdAt,
      modifiedAt: epics.modifiedAt,
    })
    .then((rows) => ({
      ...rows[0],
      ticketCount: 0,
    }));
}

export async function editEpic(
  db: ReturnType<typeof drizzle>,
  epicId: string,
  newTitle: string,
  newDescription: string | null,
): Promise<EpicRow | null> {
  const current = await db
    .select({
      id: epics.id,
      teamId: epics.teamId,
      title: epics.title,
      description: epics.description,
      createdAt: epics.createdAt,
      modifiedAt: epics.modifiedAt,
      ticketCount: sql<number>`COALESCE((SELECT COUNT(*) FROM tickets WHERE tickets.epic_id = epics.id), 0)::int`,
    })
    .from(epics)
    .where(eq(epics.id, epicId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!current) return null;

  // No-op diff: exact title comparison (epic titles are case-sensitive) and normalized description
  const normalizedDesc = newDescription === null ? null : newDescription;
  const isTitleSame = current.title === newTitle;
  const isDescSame = current.description === normalizedDesc;

  if (isTitleSame && isDescSame) {
    return {
      id: current.id,
      teamId: current.teamId,
      title: current.title,
      description: current.description,
      createdAt: current.createdAt,
      modifiedAt: current.modifiedAt,
      ticketCount: current.ticketCount,
    };
  }

  const result = await db
    .update(epics)
    .set({ title: newTitle, description: normalizedDesc, modifiedAt: new Date() })
    .where(eq(epics.id, epicId))
    .returning({
      id: epics.id,
      teamId: epics.teamId,
      title: epics.title,
      description: epics.description,
      createdAt: epics.createdAt,
      modifiedAt: epics.modifiedAt,
    })
    .then((rows) => ({
      ...rows[0],
      ticketCount: current.ticketCount,
    }));

  return result;
}

export interface DeleteEpicResult {
  ticketCount: number;
}

export async function checkDeleteEpic(
  db: ReturnType<typeof drizzle>,
  epicId: string,
): Promise<DeleteEpicResult> {
  const ticketRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(tickets)
    .where(eq(tickets.epicId, epicId));

  return {
    ticketCount: ticketRows[0]?.count ?? 0,
  };
}

export async function findTeamById(
  db: ReturnType<typeof drizzle>,
  teamId: string,
): Promise<TeamRow | null> {
  const rows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listTeams(db: ReturnType<typeof drizzle>): Promise<Array<TeamRow>> {
  return db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .orderBy(teams.createdAt);
}
