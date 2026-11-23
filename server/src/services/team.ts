import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { teams, epics, tickets } from '../db/schema.ts';

export interface TeamRow {
  id: string;
  name: string;
  createdAt: Date;
  modifiedAt: Date;
  ticketCount: number;
  epicCount: number;
}

export async function listTeams(db: ReturnType<typeof drizzle>): Promise<Array<TeamRow>> {
  return db
    .select({
      id: teams.id,
      name: teams.name,
      createdAt: teams.createdAt,
      modifiedAt: teams.modifiedAt,
      ticketCount: sql<number>`COALESCE((SELECT COUNT(*) FROM tickets WHERE tickets.team_id = teams.id), 0)::int`,
      epicCount: sql<number>`COALESCE((SELECT COUNT(*) FROM epics WHERE epics.team_id = teams.id), 0)::int`,
    })
    .from(teams)
    .orderBy(teams.createdAt);
}

export async function createTeam(
  db: ReturnType<typeof drizzle>,
  pool: Pool,
  name: string,
): Promise<{ id: string; name: string; createdAt: Date; modifiedAt: Date }> {
  return db
    .insert(teams)
    .values({ name })
    .returning({
      id: teams.id,
      name: teams.name,
      createdAt: teams.createdAt,
      modifiedAt: teams.modifiedAt,
    })
    .then((rows) => rows[0]);
}

export async function renameTeam(
  db: ReturnType<typeof drizzle>,
  teamId: string,
  newName: string,
): Promise<{ id: string; name: string; createdAt: Date; modifiedAt: Date } | null> {
  const current = await db
    .select({ id: teams.id, name: teams.name, createdAt: teams.createdAt, modifiedAt: teams.modifiedAt })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!current) return null;

  // Case-insensitive no-op check (citext semantics)
  if (current.name.toLowerCase() === newName.toLowerCase()) {
    return {
      id: current.id,
      name: current.name,
      createdAt: current.createdAt,
      modifiedAt: current.modifiedAt,
    };
  }

  const result = await db
    .update(teams)
    .set({ name: newName, modifiedAt: new Date() })
    .where(eq(teams.id, teamId))
    .returning({
      id: teams.id,
      name: teams.name,
      createdAt: teams.createdAt,
      modifiedAt: teams.modifiedAt,
    })
    .then((rows) => rows[0]);

  return result;
}

export interface DeleteTeamResult {
  hasEpics: number;
  hasTickets: number;
}

export async function checkDeleteTeam(
  db: ReturnType<typeof drizzle>,
  teamId: string,
): Promise<DeleteTeamResult> {
  const epicRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(epics)
    .where(eq(epics.teamId, teamId));

  const ticketRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(tickets)
    .where(eq(tickets.teamId, teamId));

  return {
    hasEpics: epicRows[0]?.count ?? 0,
    hasTickets: ticketRows[0]?.count ?? 0,
  };
}
