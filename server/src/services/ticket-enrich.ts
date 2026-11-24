import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { tickets, teams, users, epics } from '../db/schema.ts';

export interface TicketRow {
  id: string;
  teamId: string;
  type: string;
  state: string;
  epicId: string | null;
  title: string;
  body: string | null;
  createdBy: string;
  createdAt: Date;
  modifiedAt: Date;
}

export async function enrichTicket(
  db: ReturnType<typeof drizzle>,
  row: TicketRow,
): Promise<import('./ticket.ts').TicketRow> {
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
